// gateway.iimos.ai:带额度的 Responses API 中转。
// 请求体原样转发(text.format / tools / stream / reasoning 一个不改),只换 Authorization。
// 记账读上游返回的 usage:非流式读响应体,流式读 response.completed 事件。
type Env = { DB: D1Database; UPSTREAM_URL: string; UPSTREAM_KEY: string; ALLOWED_MODELS: string; GLOBAL_DAILY_TOKENS: string };

type KeyRow = { id: string; owner: string; total_budget: number; daily_budget: number; used_total: number; used_today: number; today: string; enabled: number };
type Usage = { input_tokens?: number; output_tokens?: number; total_tokens?: number };

const today = () => new Date().toISOString().slice(0, 10);
const sha256 = async (s: string) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))].map((b) => b.toString(16).padStart(2, '0')).join('');

/** OpenAI 风格的错误体,客户端看得懂。 */
const fail = (status: number, code: string, message: string) =>
  new Response(JSON.stringify({ error: { type: status === 429 ? 'rate_limit_error' : status === 401 ? 'authentication_error' : 'invalid_request_error', code, message } }), {
    status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
const json = (data: unknown) => new Response(JSON.stringify(data), { headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });

const bearer = (req: Request) => (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();

const loadKey = async (env: Env, token: string): Promise<KeyRow | null> => {
  if (!token.startsWith('wk_')) return null;
  return env.DB.prepare('SELECT id, owner, total_budget, daily_budget, used_total, used_today, today, enabled FROM keys WHERE token_hash = ?').bind(await sha256(token)).first<KeyRow>();
};

/** 记账:key 的今日/总量 + 全站日总量 + 明细。 */
const record = async (env: Env, key: KeyRow, model: string, usage: Usage, stream: boolean) => {
  const input = usage.input_tokens ?? 0, output = usage.output_tokens ?? 0;
  const total = usage.total_tokens ?? input + output;
  const day = today();
  await env.DB.batch([
    env.DB.prepare('UPDATE keys SET used_total = used_total + ?, used_today = CASE WHEN today = ? THEN used_today + ? ELSE ? END, today = ?, last_used_at = datetime(\'now\') WHERE id = ?').bind(total, day, total, total, day, key.id),
    env.DB.prepare('INSERT INTO daily (day, total_tokens) VALUES (?, ?) ON CONFLICT(day) DO UPDATE SET total_tokens = total_tokens + excluded.total_tokens').bind(day, total),
    env.DB.prepare('INSERT INTO usage_log (key_id, model, input_tokens, output_tokens, total_tokens, stream) VALUES (?, ?, ?, ?, ?, ?)').bind(key.id, model, input, output, total, stream ? 1 : 0),
  ]);
};

/** 从 SSE 文本流里找 response.completed 的 usage;边找边原样放行。 */
const tapUsage = (body: ReadableStream<Uint8Array>, onUsage: (u: Usage) => void) => {
  const decoder = new TextDecoder();
  let buffer = '';
  return body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      controller.enqueue(chunk);
      buffer += decoder.decode(chunk, { stream: true });
      let idx: number;
      while ((idx = buffer.indexOf('\n\n')) >= 0) {
        const block = buffer.slice(0, idx); buffer = buffer.slice(idx + 2);
        if (!block.includes('response.completed')) continue;
        const data = block.split('\n').find((l) => l.startsWith('data:'));
        if (!data) continue;
        try { const u = JSON.parse(data.slice(5).trim())?.response?.usage; if (u) onUsage(u); } catch { /* 半截 JSON 不管 */ }
      }
    },
  }));
};

const proxy = async (req: Request, env: Env, ctx: ExecutionContext) => {
  const token = bearer(req);
  if (!token) return fail(401, 'missing_key', '缺少密钥:Authorization: Bearer wk_…');
  const key = await loadKey(env, token);
  if (!key) return fail(401, 'invalid_key', '密钥无效');
  if (!key.enabled) return fail(401, 'key_disabled', '这把密钥已停用');

  const day = today();
  const usedToday = key.today === day ? key.used_today : 0;
  if (key.used_total >= key.total_budget) return fail(429, 'budget_exhausted', `总额度已用完(${key.total_budget.toLocaleString()} token)。找我要新额度。`);
  if (usedToday >= key.daily_budget) return fail(429, 'daily_exhausted', `今天的额度用完了(每天 ${key.daily_budget.toLocaleString()} token),明天再来。`);
  const globalCap = Number(env.GLOBAL_DAILY_TOKENS || 0);
  if (globalCap > 0) {
    const row = await env.DB.prepare('SELECT total_tokens FROM daily WHERE day = ?').bind(day).first<{ total_tokens: number }>();
    if ((row?.total_tokens ?? 0) >= globalCap) return fail(429, 'gateway_busy', '中转站今天的总额度用完了,明天再来。');
  }

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return fail(400, 'bad_json', '请求体不是 JSON'); }
  const model = String(body.model || '');
  const allowed = env.ALLOWED_MODELS.split(',').map((s) => s.trim()).filter(Boolean);
  if (!allowed.includes(model)) return fail(400, 'model_not_allowed', `模型只能是:${allowed.join(' / ')}`);
  const stream = body.stream === true;

  const upstream = await fetch(env.UPSTREAM_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${env.UPSTREAM_KEY}` },
    body: JSON.stringify(body),
  });
  if (!upstream.ok || !upstream.body) {
    const text = await upstream.text();
    return new Response(text, { status: upstream.status, headers: { 'content-type': upstream.headers.get('content-type') || 'application/json', 'cache-control': 'no-store' } });
  }

  const headers = new Headers({ 'content-type': upstream.headers.get('content-type') || (stream ? 'text/event-stream' : 'application/json'), 'cache-control': 'no-store' });
  if (stream) {
    const tapped = tapUsage(upstream.body, (u) => ctx.waitUntil(record(env, key, model, u, true)));
    return new Response(tapped, { status: 200, headers });
  }
  const text = await upstream.text();
  try { const u = JSON.parse(text)?.usage; if (u) ctx.waitUntil(record(env, key, model, u, false)); } catch { /* 上游不是 JSON 就不记 */ }
  return new Response(text, { status: 200, headers });
};

const me = async (req: Request, env: Env) => {
  const key = await loadKey(env, bearer(req));
  if (!key) return fail(401, 'invalid_key', '密钥无效');
  const usedToday = key.today === today() ? key.used_today : 0;
  return json({
    id: key.id, owner: key.owner, enabled: !!key.enabled,
    total: { budget: key.total_budget, used: key.used_total, left: Math.max(0, key.total_budget - key.used_total) },
    today: { budget: key.daily_budget, used: usedToday, left: Math.max(0, key.daily_budget - usedToday) },
    models: env.ALLOWED_MODELS.split(',').map((s) => s.trim()),
  });
};

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname === '/health') return json({ ok: true, service: 'gateway' });
    if (url.pathname === '/v1/responses' && req.method === 'POST') return proxy(req, env, ctx);
    if (url.pathname === '/v1/me' && req.method === 'GET') return me(req, env);
    if (url.pathname === '/v1/models' && req.method === 'GET') return json({ object: 'list', data: env.ALLOWED_MODELS.split(',').map((id) => ({ id: id.trim(), object: 'model', owned_by: 'iimos' })) });
    return fail(404, 'not_found', '只有 POST /v1/responses、GET /v1/me、GET /v1/models');
  },
};

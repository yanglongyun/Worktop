// 宿主的无状态补全(POST /apps/ai/complete)。生成不需要 agent:
// 方向是结构化输出定的,产出是单次补全写的,谁也不用碰工具。
const TIMEOUT_MS = 8 * 60 * 1000;

export const hostAiAvailable = (): boolean =>
  Boolean(process.env.HOST_URL) && Boolean(process.env.APP_TOKEN);

export async function hostComplete(system: string, prompt: string, opts: { schema?: object; title?: string } = {}): Promise<string> {
  const hostUrl = (process.env.HOST_URL ?? '').replace(/\/+$/, '');
  const res = await fetch(`${hostUrl}/apps/ai/complete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.APP_TOKEN ?? ''}` },
    body: JSON.stringify({
      prompt,
      instructions: system,
      // title 进「任务」列表 —— 让用户看得懂这次是替他干什么
      ...(opts.title ? { title: opts.title } : {}),
      ...(opts.schema ? { schema: opts.schema, schemaName: 'directions' } : {}),
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  let data: any = {};
  try { data = await res.json(); } catch { /* 非 JSON 应答按错误处理 */ }
  if (!res.ok) throw new Error(String(data?.error || `host complete failed: HTTP ${res.status}`));
  const text = String(data?.text || '');
  if (!text.trim()) throw new Error('host returned empty completion');
  return text;
}

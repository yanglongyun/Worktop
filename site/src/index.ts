// Worktop 的 Worker:一个 Worker 接两个 hostname,按 host 分派。
//
//   worktop.iimos.ai       子站(静态资源,SPA 回落);/download/* 是安装包和更新清单
//   api.worktop.iimos.ai   只做「因人而异」的事
//
// 安装包和更新清单在 worktop 自己的 R2 桶里(不和别的产品共用),经 /download/<平台>/<文件> 给出,
// 比如 /download/mac-arm64/latest-mac.yml。校验不在这里:electron-updater 用清单里的 sha512 在客户端自己核。
interface Env {
  ASSETS: Fetcher;
  RELEASES: R2Bucket;
  DB: D1Database;
  EVENTS?: AnalyticsEngineDataset;
}

type Notice = {
  id: string; kind: string; title: string; body: string; link: string;
  min_version: string; max_version: string;
};

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "content-type",
  "access-control-allow-methods": "GET,POST,OPTIONS",
};

const json = (status: number, body: unknown, cache = "no-store") =>
  Response.json(body, { status, headers: { ...CORS, "cache-control": cache } });

/** 语义化版本比较。非法输入按 0 处理 —— 客户端传什么都不该让接口 500。 */
const cmp = (a: string, b: string) => {
  const parse = (v: string) => (v.split("-")[0].split(".").map((n) => Number(n) || 0));
  const [x, y] = [parse(a), parse(b)];
  for (let i = 0; i < 3; i += 1) {
    if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) < (y[i] || 0) ? -1 : 1;
  }
  return 0;
};

const inRange = (version: string, min: string, max: string) =>
  (!min || cmp(version, min) >= 0) && (!max || cmp(version, max) <= 0);

/** 公告:按客户端版本过滤。没带版本就只发不限版本的那些。 */
const notices = async (env: Env, version: string) => {
  const rows = await env.DB
    .prepare("SELECT id, kind, title, body, link, min_version, max_version FROM notices WHERE published = 1 ORDER BY created_at DESC LIMIT 50")
    .all<Notice>();
  const list = (rows.results || [])
    .filter((n) => (version ? inRange(version, n.min_version, n.max_version) : !n.min_version && !n.max_version))
    .map(({ id, kind, title, body, link }) => ({ id, kind, title, body, link }));
  return json(200, { notices: list }, "public, max-age=300");
};

/** 遥测:只收事件名与几个维度,不收内容。写 Analytics Engine。 */
const telemetry = async (request: Request, env: Env) => {
  const body = await request.json<any>().catch(() => null);
  const event = String(body?.event || "").slice(0, 64);
  if (!event) return json(400, { error: "event required" });
  env.EVENTS?.writeDataPoint({
    blobs: [
      event,
      String(body?.version || "").slice(0, 32),
      String(body?.platform || "").slice(0, 32),
      String(body?.install || "").slice(0, 64),
    ],
    indexes: [event],
  });
  return json(202, { ok: true });
};

const TYPES: Record<string, string> = {
  dmg: "application/x-apple-diskimage", zip: "application/zip", exe: "application/octet-stream",
  yml: "text/yaml; charset=utf-8", blockmap: "application/octet-stream",
};

/** 安装包和更新清单:整包、分段(electron-updater 的差量更新要用)、条件请求;不存在回 404。 */
const download = async (request: Request, env: Env, key: string) => {
  if (request.method !== "GET" && request.method !== "HEAD") return new Response("method not allowed", { status: 405 });
  if (!key || key.includes("..")) return new Response("not found", { status: 404 });
  const ranged = request.headers.has("range");
  const object = await env.RELEASES.get(key, { ...(ranged ? { range: request.headers } : {}), onlyIf: request.headers });
  if (!object) return new Response("not found", { status: 404 });
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  if (!headers.has("content-type")) headers.set("content-type", TYPES[key.split(".").pop() || ""] || "application/octet-stream");
  headers.set("etag", object.httpEtag);
  headers.set("accept-ranges", "bytes");
  headers.set("access-control-allow-origin", "*");
  // 更新清单不能缓存,不然永远发不出新版本;安装包文件名带版本号,可以长缓存
  headers.set("cache-control", /\.(yml|json)$/.test(key) ? "no-cache" : "public, max-age=31536000, immutable");
  if (!("body" in object)) return new Response(null, { status: 304, headers });
  if (ranged && object.range && "offset" in object.range) {
    const offset = object.range.offset ?? 0;
    const length = object.range.length ?? object.size - offset;
    headers.set("content-range", `bytes ${offset}-${offset + length - 1}/${object.size}`);
    return new Response(request.method === "HEAD" ? null : object.body, { status: 206, headers });
  }
  headers.set("content-length", String(object.size));
  return new Response(request.method === "HEAD" ? null : object.body, { headers });
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (!url.hostname.startsWith("api.") && url.pathname.startsWith("/download/")) {
      return download(request, env, decodeURIComponent(url.pathname.slice("/download/".length)));
    }

    // 子站:静态资源交给 ASSETS,SPA 回落由 assets 配置处理
    if (!url.hostname.startsWith("api.")) return env.ASSETS.fetch(request);

    if (request.method === "OPTIONS") return new Response(null, { headers: CORS });
    if (url.pathname === "/health") return json(200, { ok: true, service: "worktop" });

    if (url.pathname === "/notices" && request.method === "GET") {
      return notices(env, url.searchParams.get("version") || "");
    }
    if (url.pathname === "/t" && request.method === "POST") {
      return telemetry(request, env);
    }
    return json(404, { error: "not found" });
  },
};

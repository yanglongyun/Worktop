// 组件站点:每个组件一个 loopback 端口 —— 也就是一个**真 origin**。
//
// 为什么不走「一个端口 + /widgets/<id>/ 路径前缀」(踩过的坑):
// 浏览器会把 <link href="/style.css">、fetch("/api/…") 解析到 origin 根,绕过前缀 → 404。
// 给真 origin 之后,组件拿到的是真正的根,绝对路径与相对路径都对,不需要任何注入垫片。
//
// 白拿的三个好处:
//   1. 不同端口 = 不同 origin → localStorage / cookie 天然互不可见,隔离不用靠 sandbox 兜;
//   2. 宿主 API 与组件**同源**(/widgets/* 由本端口自己应答)→ 组件写 fetch("/widgets/sql") 即可;
//   3. 凭据由宿主在服务端注入,**永远不出现在页面里** —— 组件根本不知道自己是谁在替它签名。
import http from "http";
import { getWidget, widgetFile, listWidgets } from "./registry.js";
import { batchWidgetSql, execWidgetSql } from "./db.js";
import { runWidgetAi } from "./ai.js";
import { emit } from "../bus.js";

// /widgets/confirm 的往返:emit 出去,等界面把用户的选择送回来(/api/widgets/confirm/result)
const pendingConfirms = new Map<string, (ok: boolean) => void>();
export const resolveWidgetConfirm = (requestId: string, ok: boolean) => {
  const resolve = pendingConfirms.get(String(requestId));
  if (!resolve) return false;
  pendingConfirms.delete(String(requestId));
  resolve(ok);
  return true;
};
import { fetchForWidget } from "./net.js";

type Site = { port: number; server: http.Server; lastHit: number };

const sites = new Map<string, Site>();
const IDLE_MS = 30 * 60 * 1000; // 闲置 30 分钟回收,下次访问再起

const MIME: Record<string, string> = {
  html: "text/html; charset=utf-8", htm: "text/html; charset=utf-8",
  js: "text/javascript; charset=utf-8", mjs: "text/javascript; charset=utf-8",
  css: "text/css; charset=utf-8", json: "application/json; charset=utf-8",
  svg: "image/svg+xml", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg",
  gif: "image/gif", webp: "image/webp", ico: "image/x-icon", woff2: "font/woff2",
  txt: "text/plain; charset=utf-8", md: "text/plain; charset=utf-8",
};

// connect-src 'self' 就是轻量版的物理断网:组件的 JS 连不上任何外部地址,
// 想外传数据也没有通道。这是「AI 写的组件可以随便跑」的地基。
const CSP = [
  "default-src 'self'",
  "connect-src 'self'",
  "img-src 'self' data: blob:",
  "style-src 'self' 'unsafe-inline'",
  "script-src 'self' 'unsafe-inline'",
  "frame-ancestors *", // 宿主要把它嵌进面板
].join("; ");

/** 主题变量:注入进每个 HTML,组件不需要引入任何东西就能跟随明暗。 */
const THEME_TAG = `<style id="wb-theme">:root{color-scheme:light dark;
  --bg:#fff;--bg-raised:#f7f7f8;--bg-hover:#f0f0f2;--text:#1a1a1a;--text-dim:#6b6b70;
  --border:#e3e3e6;--accent:#2f6fed;--danger:#d64545;}
@media (prefers-color-scheme:dark){:root{
  --bg:#1c1c1e;--bg-raised:#252528;--bg-hover:#2e2e32;--text:#e8e8ea;--text-dim:#9a9aa0;
  --border:#35353a;--accent:#5b8cff;--danger:#ff6b6b;}}
html,body{background:var(--bg);color:var(--text);margin:0;}</style>`;

const json = (res: http.ServerResponse, code: number, body: unknown) => {
  const text = JSON.stringify(body);
  res.writeHead(code, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(text);
};

const readBody = (req: http.IncomingMessage) =>
  new Promise<any>((resolve) => {
    let raw = "";
    req.on("data", (c) => { raw += c; if (raw.length > 4 * 1024 * 1024) req.destroy(); });
    req.on("end", () => { try { resolve(JSON.parse(raw || "{}")); } catch { resolve({}); } });
    req.on("error", () => resolve({}));
  });

/** 能力网关:manifest 没声明的一律拒。ui 类能力免申请。 */
const need = (id: string, permission: string) => {
  const widget = getWidget(id);
  if (!widget) throw new Error("组件不存在");
  if (!widget.permissions.includes(permission)) {
    throw new Error(`未声明权限:${permission}(在 widget.json 的 permissions 里加上它)`);
  }
};

/** 宿主 API:同源 HTTP,没有 SDK —— 与挂载方式正交(iframe/标签页/curl 都一样能调)。 */
const handleWidgetHostRequest = async (id: string, rel: string, req: http.IncomingMessage, res: http.ServerResponse) => {
  const method = req.method || "GET";
  try {
    if (rel === "/context" && method === "GET") {
      const widget = getWidget(id);
      return json(res, 200, { ok: true, id, name: widget?.name || id, permissions: widget?.permissions || [] });
    }
    if (rel === "/sql" && method === "POST") {
      need(id, "sql");
      const body = await readBody(req);
      const r = execWidgetSql(id, String(body?.sql || ""), Array.isArray(body?.params) ? body.params : []);
      return json(res, 200, { ok: true, rows: r.rows || [], changes: r.changes || 0, lastInsertRowid: r.lastInsertRowid || 0 });
    }
    if (rel === "/sql/batch" && method === "POST") {
      need(id, "sql");
      const body = await readBody(req);
      const { results } = batchWidgetSql(id, Array.isArray(body?.statements) ? body.statements : []);
      return json(res, 200, { ok: true, results });
    }
    if (rel === "/toast" && method === "POST") {
      // ui 类,免申请:右下角轻提示
      const body = await readBody(req);
      const message = String(body?.message || "").trim().slice(0, 200);
      if (!message) return json(res, 400, { ok: false, error: "message 不能为空" });
      const widget = getWidget(id);
      emit({ type: "widget_toast", widgetId: id, message: `${widget?.name || id}:${message}` });
      return json(res, 200, { ok: true });
    }
    if (rel === "/confirm" && method === "POST") {
      // ui 类,免申请:全局确认框,阻塞到用户选择(2 分钟没人理 = 取消)
      const body = await readBody(req);
      const message = String(body?.message || "").trim().slice(0, 500);
      if (!message) return json(res, 400, { ok: false, error: "message 不能为空" });
      const widget = getWidget(id);
      const requestId = crypto.randomUUID();
      const ok = await new Promise<boolean>((resolve) => {
        pendingConfirms.set(requestId, resolve);
        emit({ type: "widget_confirm", widgetId: id, requestId, message: `「${widget?.name || id}」组件问:\n${message}` });
        setTimeout(() => { if (pendingConfirms.delete(requestId)) resolve(false); }, 120_000).unref?.();
      });
      return json(res, 200, { ok: true, confirmed: ok });
    }
    if (rel === "/open" && method === "POST") {
      // ui 类能力,免申请:把一个链接开进工作台的网页标签(而不是被 Electron 丢去系统浏览器)
      const body = await readBody(req);
      let target: URL;
      try { target = new URL(String(body?.url || "")); } catch { return json(res, 400, { ok: false, error: "url 不合法" }); }
      if (target.protocol !== "https:" && target.protocol !== "http:") {
        return json(res, 400, { ok: false, error: "只支持 http(s)" });
      }
      emit({ type: "widget_open_url", widgetId: id, url: target.href });
      return json(res, 200, { ok: true });
    }
    if (rel === "/http" && method === "POST") {
      need(id, "net");
      const body = await readBody(req);
      const r = await fetchForWidget(getWidget(id)?.hosts || [], String(body?.url || ""));
      return json(res, 200, { ok: true, ...r });
    }
    if (rel === "/ai" && method === "POST") {
      need(id, "ai");
      const body = await readBody(req);
      const r = await runWidgetAi({ widgetId: id, summary: String(body?.summary || ""), system: String(body?.system || ""), prompt: String(body?.prompt || "") });
      return json(res, 200, { ok: true, ...r });
    }
    return json(res, 404, { ok: false, error: `未知端点:${rel}` });
  } catch (e: any) {
    return json(res, 400, { ok: false, error: String(e?.message || e) });
  }
};

const serve = async (id: string, req: http.IncomingMessage, res: http.ServerResponse) => {
  const site = sites.get(id);
  if (site) site.lastHit = Date.now();
  const url = new URL(req.url || "/", "http://127.0.0.1");
  let pathname = decodeURIComponent(url.pathname);

  if (pathname.startsWith("/widgets/")) return handleWidgetHostRequest(id, pathname.slice("/widgets".length), req, res);

  if (pathname.endsWith("/")) pathname += "index.html";
  const file = widgetFile(id, pathname);
  if (!file) {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("not found");
    return;
  }
  const headers: Record<string, string> = {
    "content-type": MIME[file.ext] || "application/octet-stream",
    "cache-control": "no-cache", // 改完文件下次打开即新版
    "content-security-policy": CSP,
  };
  if (file.ext === "html" || file.ext === "htm") {
    // 主题变量注入进 <head>(没有 head 就放最前面),组件不需要引入任何东西
    let html = file.buf.toString("utf8");
    html = /<head[^>]*>/i.test(html)
      ? html.replace(/<head[^>]*>/i, (h) => h + THEME_TAG)
      : THEME_TAG + html;
    const body = Buffer.from(html, "utf8");
    res.writeHead(200, { ...headers, "content-length": String(body.length) });
    res.end(body);
    return;
  }
  res.writeHead(200, { ...headers, "content-length": String(file.buf.length) });
  res.end(file.buf);
};

/** 拿组件站点的端口(没有就现开一个,只听 127.0.0.1)。 */
export const widgetSitePort = async (id: string): Promise<number | null> => {
  if (!getWidget(id)) return null;
  const existing = sites.get(id);
  if (existing) { existing.lastHit = Date.now(); return existing.port; }
  const server = http.createServer((req, res) => { void serve(id, req, res); });
  const port = await new Promise<number | null>((resolve) => {
    server.once("error", () => resolve(null));
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      resolve(typeof addr === "object" && addr ? addr.port : null);
    });
  });
  if (port == null) { server.close(); return null; }
  sites.set(id, { port, server, lastHit: Date.now() });
  return port;
};

export const closeWidgetSite = (id: string) => {
  const site = sites.get(id);
  if (!site) return;
  sites.delete(id);
  try { site.server.close(); } catch { /* 已经没了 */ }
};

/** 闲置回收:装几十个组件也不会长期占着几十个监听。 */
export const startWidgetSiteSweeper = () => {
  const timer = setInterval(() => {
    const now = Date.now();
    for (const [id, site] of sites) {
      if (now - site.lastHit > IDLE_MS) closeWidgetSite(id);
      else if (!getWidget(id)) closeWidgetSite(id); // 组件没了,端口跟着走
    }
  }, 5 * 60 * 1000);
  timer.unref?.();
};


/** 供调试:当前在跑的组件站点。 */
export const listWidgetSites = () =>
  [...sites.entries()].map(([id, s]) => ({ id, port: s.port, idleMs: Date.now() - s.lastHit, exists: !!listWidgets().find((w) => w.id === id) }));

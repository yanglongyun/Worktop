// 应用的路由面:列表 / 取址(顺手拉起)/ 停 / 重启 / 图标 / APP.md。
//
// 取址是核心的那一个:**地址永远现问,不许缓存端口**(契约,见仓库根 APP.md)。
// 界面和 agent 走同一个端点 —— 取址即保活,没起的会被顺手拉起。
import { createReadStream, existsSync } from "node:fs";
import path from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import { getApp, listApps, readAppDoc } from "../../apps/registry.js";
import { appStatus, ensureApp, restartApp, stopApp } from "../../apps/supervisor.js";

import { json, parseBody } from "./helpers.js";

const publicApp = (app: ReturnType<typeof getApp>) => {
  if (!app) return null;
  const { status, error, port } = appStatus(app.id);
  return {
    id: app.id, name: app.name, version: app.version, description: app.description,
    permissions: app.permissions, hasIcon: !!app.iconFile, hasDoc: app.hasDoc,
    mode: app.run?.mode || "static", invalid: app.invalid,
    status, error, port,
  };
};

export const handleAppRoutes = async (
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  method: string,
): Promise<boolean> => {
  const p = url.pathname;
  if (!p.startsWith("/api/apps")) return false;
  const id = url.searchParams.get("id") || "";
  /** POST 的 id 在 body 里(前端一直这么发),GET 的在 query —— 两边都认。 */
  const idFrom = async () => id || String((await parseBody(req))?.id || "");

  if (p === "/api/apps" && method === "GET") {
    json(res, 200, { apps: listApps().map(publicApp) });
    return true;
  }

  // 取址:没起就拉起,起着就续命。返回真 origin —— 每个 app 一个端口
  if (p === "/api/apps/address" && method === "GET") {
    try {
      const record = await ensureApp(id);
      json(res, 200, { origin: `http://127.0.0.1:${record.port}` });
    } catch (e: any) {
      json(res, e?.status || 500, { error: String(e?.message || e) });
    }
    return true;
  }

  if (p === "/api/apps/stop" && method === "POST") {
    const target = await idFrom();
    if (!getApp(target)) { json(res, 404, { error: "应用不存在" }); return true; }
    json(res, 200, { ok: await stopApp(target) });
    return true;
  }

  if (p === "/api/apps/restart" && method === "POST") {
    const target = await idFrom();
    if (!getApp(target)) { json(res, 404, { error: "应用不存在" }); return true; }
    try { await restartApp(target); json(res, 200, { ok: true }); }
    catch (e: any) { json(res, e?.status || 500, { error: String(e?.message || e) }); }
    return true;
  }

  /** APP.md 原文:渐进披露的第二级 —— 提示词里只有一行,模型要细节自己来取。 */
  if (p === "/api/apps/doc" && method === "GET") {
    json(res, 200, { doc: readAppDoc(id) });
    return true;
  }

  if (p === "/api/apps/icon" && method === "GET") {
    const app = getApp(id);
    if (!app?.iconFile || !existsSync(app.iconFile)) { res.writeHead(404); res.end(); return true; }
    const type = path.extname(app.iconFile) === ".png" ? "image/png" : "image/svg+xml";
    res.writeHead(200, { "content-type": type, "cache-control": "private, max-age=300" });
    createReadStream(app.iconFile).pipe(res);
    return true;
  }

  return false;
};

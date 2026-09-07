// 网站面板:收藏(一棵浅树)、浏览记录、站点图标代理。
import type { IncomingMessage, ServerResponse } from "node:http";
import * as bookmarks from "../../browser/bookmarks.js";
import * as passwords from "../../browser/passwords.js";
import * as history from "../../browser/history.js";
import { serveFavicon } from "../../browser/favicons.js";
import { attempt, json, parseBody } from "./helpers.js";

export const handleBrowserRoutes = async (req: IncomingMessage, res: ServerResponse, url: URL, method: string): Promise<boolean> => {
  const path = url.pathname;
  if (path === "/api/browser/favicon" && method === "GET") { serveFavicon(url.searchParams.get("url"), res); return true; }

  if (path === "/api/browser/bookmarks") {
    if (method === "GET") { json(res, 200, { ok: true, bookmarks: bookmarks.list() }); return true; }
    if (method === "POST") return attempt(res, 201, async () => ({ item: bookmarks.create(await parseBody(req)) }));
    if (method === "PATCH") return attempt(res, 200, async () => ({ item: bookmarks.update(String(url.searchParams.get("id") || ""), await parseBody(req)) }));
    if (method === "DELETE") { json(res, 200, { ok: true, deleted: bookmarks.remove(String(url.searchParams.get("id") || "")) }); return true; }
  }
  // 新建文件夹;整层顺序重排(拖拽后一次发全量,顺序与归属一起改)
  if (path === "/api/browser/bookmarks/folder" && method === "POST") return attempt(res, 201, async () => ({ item: bookmarks.createFolder(await parseBody(req)) }));
  if (path === "/api/browser/bookmarks/order" && method === "POST") { json(res, 200, { ok: true, bookmarks: bookmarks.reorder(await parseBody(req)) }); return true; }

  if (path === "/api/browser/history") {
    if (method === "GET") {
      json(res, 200, { ok: true, history: history.list({ q: url.searchParams.get("q") ?? undefined, limit: Number(url.searchParams.get("limit")) }) });
      return true;
    }
    if (method === "DELETE") {
      json(res, 200, { ok: true, forgot: history.forget({ url: url.searchParams.get("url") ?? undefined, all: url.searchParams.get("all") === "1" }) });
      return true;
    }
  }
  if (path === "/api/browser/history/visit" && method === "POST") { json(res, 200, { ok: true, noted: history.visit(await parseBody(req)) }); return true; }
  try {
    if (path === "/api/browser/passwords" && method === "GET") { json(res, 200, { ok: true, passwords: passwords.list() }); return true; }
    if (path === "/api/browser/passwords" && method === "POST") { json(res, 201, { ok: true, item: passwords.create(await parseBody(req)) }); return true; }
    if (path === "/api/browser/passwords" && method === "PATCH") {
      json(res, 200, { ok: true, item: passwords.update(String(url.searchParams.get("id") || ""), await parseBody(req)) }); return true;
    }
    if (path === "/api/browser/passwords" && method === "DELETE") {
      if (url.searchParams.get("all") === "1") { json(res, 200, { ok: true, cleared: passwords.clear() }); return true; }
      json(res, 200, { ok: true, deleted: passwords.remove(String(url.searchParams.get("id") || "")) }); return true;
    }
    if (path === "/api/browser/passwords/reveal" && method === "GET") {
      const password = passwords.reveal(String(url.searchParams.get("id") || ""));
      if (password === null) { json(res, 404, { ok: false, error: "没有这一条" }); return true; }
      res.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
      res.end(JSON.stringify({ ok: true, password })); return true;
    }
    if (path === "/api/browser/passwords/import" && method === "POST") {
      const body = await parseBody(req);
      json(res, 200, { ok: true, added: passwords.importMany(body.items) }); return true;
    }
    if (path === "/api/browser/passwords/export" && method === "GET") {
      res.writeHead(200, { "content-type": "text/csv; charset=utf-8", "cache-control": "no-store" });
      res.end("﻿" + passwords.exportCsv()); return true;
    }
    return false;
  } catch (e: any) {
    json(res, 400, { ok: false, error: e?.message || "失败" }); return true;
  }
};

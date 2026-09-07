// 密码的路由面。列表不带密码;明文只在 reveal / export 时解出来。
import type { IncomingMessage, ServerResponse } from "node:http";
import * as passwords from "../../sites/passwords.js";

import { json, parseBody } from "./helpers.js";

export const handlePasswordRoutes = async (req: IncomingMessage, res: ServerResponse, url: URL, method: string) => {
  const p = url.pathname;
  if (!p.startsWith("/api/passwords")) return false;
  try {
    if (p === "/api/passwords" && method === "GET") { json(res, 200, { ok: true, passwords: passwords.list() }); return true; }
    if (p === "/api/passwords" && method === "POST") { json(res, 201, { ok: true, item: passwords.create(await parseBody(req)) }); return true; }
    if (p === "/api/passwords" && method === "PATCH") {
      json(res, 200, { ok: true, item: passwords.update(String(url.searchParams.get("id") || ""), await parseBody(req)) }); return true;
    }
    if (p === "/api/passwords" && method === "DELETE") {
      if (url.searchParams.get("all") === "1") { json(res, 200, { ok: true, cleared: passwords.clear() }); return true; }
      json(res, 200, { ok: true, deleted: passwords.remove(String(url.searchParams.get("id") || "")) }); return true;
    }
    if (p === "/api/passwords/reveal" && method === "GET") {
      const password = passwords.reveal(String(url.searchParams.get("id") || ""));
      if (password === null) { json(res, 404, { ok: false, error: "没有这一条" }); return true; }
      res.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
      res.end(JSON.stringify({ ok: true, password })); return true;
    }
    if (p === "/api/passwords/import" && method === "POST") {
      const body = await parseBody(req);
      json(res, 200, { ok: true, added: passwords.importMany(body.items) }); return true;
    }
    if (p === "/api/passwords/export" && method === "GET") {
      res.writeHead(200, { "content-type": "text/csv; charset=utf-8", "cache-control": "no-store" });
      res.end("﻿" + passwords.exportCsv()); return true;
    }
    json(res, 404, { ok: false, error: "not found" }); return true;
  } catch (e: any) {
    json(res, 400, { ok: false, error: e?.message || "失败" }); return true;
  }
};

// 文件树、常用根目录、预览与附件。
import fs from "node:fs";
import * as attachments from "../../files/attachments.js";
import nodePath from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import * as tree from "../../files/service.js";
import { syncWatchers } from "../../files/watcher.js";
import { attempt, json, parseBody, serveFile } from "./helpers.js";

const RAW_MIME: Record<string, string> = {
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".gif": "image/gif", ".webp": "image/webp", ".svg": "image/svg+xml",
  ".ico": "image/x-icon", ".bmp": "image/bmp", ".avif": "image/avif",
  ".pdf": "application/pdf",
};

export const handleFileRoutes = async (req: IncomingMessage, res: ServerResponse, url: URL, method: string): Promise<boolean> => {
  const path = url.pathname;
  const id = () => String(url.searchParams.get("id") || "");

  // ---- tree(纯文件树:文件夹 / 文件)----
  if (path === "/api/files/tree/copy" && method === "POST") {
    return attempt(res, 201, async () => { const body = await parseBody(req); return { item: tree.copy(body.id, body.parentId || null) }; });
  }
  if (path === "/api/files/tree/import" && method === "POST") return attempt(res, 201, async () => ({ item: tree.importFile(await parseBody(req)) }));
  if (path === "/api/files/tree") {
    if (method === "GET") { json(res, 200, { ok: true, items: tree.listChildren(url.searchParams.get("parentId")) }); return true; }
    if (method === "POST") return attempt(res, 201, async () => ({ item: tree.create(await parseBody(req)) }));
    if (method === "PATCH") return attempt(res, 200, async () => ({ item: tree.update(id(), await parseBody(req)) }));
    if (method === "DELETE") return attempt(res, 200, () => { tree.remove(id()); return {}; });
  }
  if (path === "/api/files/tree/get" && method === "GET") {
    const item = tree.getItem(id());
    if (!item) { json(res, 404, { ok: false, error: "not found" }); return true; }
    json(res, 200, { ok: true, item }); return true;
  }
  // 全树扁平列表(⌘P 快速打开)
  if (path === "/api/files/tree/all" && method === "GET") { json(res, 200, { ok: true, items: tree.listAll() }); return true; }

  // 常用根目录
  if (path === "/api/files/roots") {
    if (method === "GET") { json(res, 200, { ok: true, roots: tree.listRoots() }); return true; }
    if (method === "POST") {
      return attempt(res, 201, async () => {
        const item = tree.addRoot(await parseBody(req));
        syncWatchers(); // 新根挂上文件监听
        return { item };
      });
    }
    if (method === "DELETE") {
      return attempt(res, 200, () => {
        const root = tree.removeRoot(id());
        syncWatchers(); // 摘掉的根不再监听
        return { root };
      });
    }
  }

  // 原始文件流(图片/PDF 等二进制预览用)
  if (path === "/api/files/raw" && method === "GET") {
    const abs = tree.fileRawAbs(id());
    if (!abs) { json(res, 404, { ok: false, error: "not found" }); return true; }
    const ext = nodePath.extname(abs).toLowerCase();
    res.writeHead(200, {
      "Content-Type": RAW_MIME[ext] || "application/octet-stream",
      "Cache-Control": "no-cache",
      "Access-Control-Allow-Origin": "*",
    });
    res.end(fs.readFileSync(abs));
    return true;
  }
  // 按路径服务常用目录内文件(HTML 预览用 —— iframe 在 /api/files/local/<dir>/index.html,
  // 相对的 styles.css 自然解析到 /api/files/local/<dir>/styles.css)。仅限常用目录根内的文件。
  if (path.startsWith("/api/files/local/") && method === "GET") {
    let abs: string;
    try { abs = decodeURIComponent(path.slice("/api/files/local".length)); }
    catch { abs = path.slice("/api/files/local".length); }
    const real = tree.fileRawAbs(abs);
    if (!real) { json(res, 404, { ok: false, error: "not found" }); return true; }
    serveFile(res, real);
    return true;
  }
  if (path === "/api/files/upload" && method === "POST") return attempt(res, 201, async () => ({ attachment: attachments.upload(await parseBody(req)) }));
  if (path.startsWith("/api/files/attachments/") && method === "GET") {
    const id = decodeURIComponent(path.slice("/api/files/attachments/".length));
    if (attachments.serve(id, res)) return true;
    json(res, 404, { ok: false, error: "文件不存在" }); return true;
  }
  return false;
};

// 文件树与工作区:树的增删改查、复制、导入、全树列表、原始文件流、
// 按路径服务工作区文件(HTML 预览)、在系统文件管理器里显示。
import fs from "node:fs";
import nodePath from "node:path";
import { execFile } from "node:child_process";
import type { IncomingMessage, ServerResponse } from "node:http";
import * as tree from "../../workspace/treeService.js";
import { pickDirectory } from "../../workspace/directoryPicker.js";
import { syncWatchers } from "../../workspace/watcher.js";
import { attempt, json, parseBody, serveFile } from "./helpers.js";

const RAW_MIME: Record<string, string> = {
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".gif": "image/gif", ".webp": "image/webp", ".svg": "image/svg+xml",
  ".ico": "image/x-icon", ".bmp": "image/bmp", ".avif": "image/avif",
  ".pdf": "application/pdf",
};

export const handleWorkspaceRoutes = async (req: IncomingMessage, res: ServerResponse, url: URL, method: string): Promise<boolean> => {
  const path = url.pathname;
  const id = () => String(url.searchParams.get("id") || "");

  // ---- tree(纯文件树:文件夹 / 文件)----
  if (path === "/api/tree/copy" && method === "POST") {
    return attempt(res, 201, async () => { const body = await parseBody(req); return { item: tree.copy(body.id, body.parentId || null) }; });
  }
  if (path === "/api/tree/import" && method === "POST") return attempt(res, 201, async () => ({ item: tree.importFile(await parseBody(req)) }));
  if (path === "/api/tree") {
    if (method === "GET") { json(res, 200, { ok: true, items: tree.listChildren(url.searchParams.get("parentId")) }); return true; }
    if (method === "POST") return attempt(res, 201, async () => ({ item: tree.create(await parseBody(req)) }));
    if (method === "PATCH") return attempt(res, 200, async () => ({ item: tree.update(id(), await parseBody(req)) }));
    if (method === "DELETE") return attempt(res, 200, () => { tree.remove(id()); return {}; });
  }
  if (path === "/api/tree/get") {
    const item = tree.getItem(id());
    if (!item) { json(res, 404, { ok: false, error: "not found" }); return true; }
    json(res, 200, { ok: true, item }); return true;
  }
  // 全树扁平列表(⌘P 快速打开)
  if (path === "/api/tree/all" && method === "GET") { json(res, 200, { ok: true, items: tree.listAll() }); return true; }

  // ---- workspaces(root folders)----
  if (path === "/api/workspaces/pick" && method === "POST") return attempt(res, 200, async () => ({ path: await pickDirectory() }));
  if (path === "/api/workspaces") {
    if (method === "GET") { json(res, 200, { ok: true, workspaces: tree.listWorkspaces() }); return true; }
    if (method === "POST") {
      return attempt(res, 201, async () => {
        const item = tree.addWorkspace(await parseBody(req));
        syncWatchers(); // 新根挂上文件监听
        return { item };
      });
    }
    if (method === "DELETE") {
      return attempt(res, 200, () => {
        const workspace = tree.removeWorkspace(id());
        syncWatchers(); // 摘掉的根不再监听
        return { workspace };
      });
    }
  }

  // 原始文件流(图片/PDF 等二进制预览用)
  if (path === "/api/file/raw" && method === "GET") {
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
  // 按路径服务工作区内文件(HTML 预览用 —— iframe 在 /api/fs/<dir>/index.html,
  // 相对的 styles.css 自然解析到 /api/fs/<dir>/styles.css)。仅限工作区根内的文件。
  if (path.startsWith("/api/fs/") && method === "GET") {
    let abs: string;
    try { abs = decodeURIComponent(path.slice("/api/fs".length)); }
    catch { abs = path.slice("/api/fs".length); }
    const real = tree.fileRawAbs(abs);
    if (!real) { json(res, 404, { ok: false, error: "not found" }); return true; }
    serveFile(res, real);
    return true;
  }
  // 在系统文件管理器里显示文件或文件夹。
  if (path === "/api/reveal" && method === "POST") {
    const abs = tree.pathForId(id());
    if (!abs) { json(res, 404, { ok: false, error: "not found" }); return true; }
    const plt = process.platform;
    const [cmd, args] = plt === "darwin" ? ["open", ["-R", abs]]
      : plt === "win32" ? ["explorer", [`/select,${abs}`]]
        : ["xdg-open", [nodePath.dirname(abs)]];
    execFile(cmd, args, () => {}); // 部分平台(如 explorer)成功也返回非 0,忽略
    json(res, 200, { ok: true, path: abs });
    return true;
  }
  return false;
};

// 路由共用的几个小帮手。
import fs from "node:fs";
import nodePath from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";

export const json = (res: ServerResponse, code: number, data: unknown) => {
  res.writeHead(code, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data, null, 2) + "\n");
};

export const parseBody = async (req: IncomingMessage): Promise<any> => {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
};

/** 出错统一成 400 + 人话;抛出来的东西不带 status 就按参数错误算。 */
export const attempt = async (res: ServerResponse, code: number, work: () => unknown | Promise<unknown>) => {
  try { json(res, code, { ok: true, ...(await work() as object) }); }
  catch (error: any) { json(res, 400, { ok: false, error: String(error?.message || error) }); }
  return true;
};

// 静态文件 mime —— 给 /api/files/local(按路径服务,供 HTML 预览解析相对资源)和 /api/files/raw 复用
const MIME: Record<string, string> = {
  ".html": "text/html", ".htm": "text/html",
  ".css": "text/css", ".js": "text/javascript", ".mjs": "text/javascript",
  ".json": "application/json", ".svg": "image/svg+xml",
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".gif": "image/gif", ".webp": "image/webp", ".ico": "image/x-icon",
  ".bmp": "image/bmp", ".avif": "image/avif", ".pdf": "application/pdf",
  ".txt": "text/plain", ".md": "text/plain",
};

export const serveFile = (res: ServerResponse, abs: string, extraHeaders: Record<string, string> = {}) => {
  const type = MIME[nodePath.extname(abs).toLowerCase()] || "application/octet-stream";
  const textish = type.startsWith("text/") || type.endsWith("json") || type.endsWith("svg+xml");
  res.writeHead(200, {
    "Content-Type": textish ? `${type}; charset=utf-8` : type,
    "Cache-Control": "no-cache",
    ...extraHeaders,
  });
  res.end(fs.readFileSync(abs));
};

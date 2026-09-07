import { DATA_HOME } from "../system/paths.js";
// 网站图标:抓取 + 磁盘缓存 + 回源代理。只直连站点自身,不依赖任何第三方图标服务。
//   1) 先试 <origin>/favicon.ico;2) 不行就取页面 HTML 里的 <link rel*="icon">。
// 命中落盘 $WORKTOP_HOME/favicons/<host>.<ext>,未命中记内存负缓存 1 小时。
// 按字节魔数识别真图 —— content-type 说谎(text/plain 的 ico 满街都是)也认得。
import fs from "fs";
import path from "path";
import type { ServerResponse } from "http";

const DIR = path.join(DATA_HOME, "favicons");

const EXTS = ["png", "ico", "svg", "jpg", "gif", "webp"];
const TYPE_BY_EXT: Record<string, string> = {
  png: "image/png", ico: "image/x-icon", svg: "image/svg+xml",
  jpg: "image/jpeg", gif: "image/gif", webp: "image/webp",
};
const EXT_BY_TYPE: Record<string, string> = {
  "image/png": "png", "image/x-icon": "ico", "image/vnd.microsoft.icon": "ico",
  "image/svg+xml": "svg", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp",
};
/** host → 负缓存过期时间(避免对没有图标的站反复回源)。 */
const misses = new Map<string, number>();

const sniffExt = (buf: Buffer | null, type?: string): string | null => {
  if (!buf || buf.length < 4) return null;
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return "png";
  if (buf[0] === 0 && buf[1] === 0 && (buf[2] === 1 || buf[2] === 2) && buf[3] === 0) return "ico";
  if (buf.subarray(0, 3).toString("latin1") === "GIF") return "gif";
  if (buf[0] === 0xff && buf[1] === 0xd8) return "jpg";
  if (buf.subarray(0, 4).toString("latin1") === "RIFF" && buf.subarray(8, 12).toString("latin1") === "WEBP") return "webp";
  const head = buf.subarray(0, 300).toString("utf8").trimStart().toLowerCase();
  if (head.startsWith("<svg") || (head.startsWith("<?xml") && head.includes("<svg"))) return "svg";
  return EXT_BY_TYPE[String(type || "").toLowerCase()] || null;
};

const fetchBytes = async (target: string, maxBytes = 512 * 1024) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6000);
  try {
    const res = await fetch(target, {
      signal: controller.signal,
      redirect: "follow",
      headers: { "user-agent": "Mozilla/5.0 (Macintosh) Worktop", accept: "*/*" },
    });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (!buf.length || buf.length > maxBytes) return null;
    return { buf, type: String(res.headers.get("content-type") || "").split(";")[0].trim() };
  } catch { return null; } finally { clearTimeout(timer); }
};

/** 从页面 HTML 里挖 <link rel*="icon"> 的地址。 */
const findHtmlIcon = async (origin: string): Promise<string | null> => {
  const page = await fetchBytes(origin, 300 * 1024);
  if (!page) return null;
  const html = page.buf.toString("utf8");
  for (const m of html.matchAll(/<link\b[^>]*rel=["']?[^"'>]*icon[^"'>]*["']?[^>]*>/gi)) {
    const href = /href=["']?([^"' >]+)/i.exec(m[0])?.[1];
    if (href) {
      try { return new URL(href, origin).toString(); } catch { /* 无效地址,下一个 */ }
    }
  }
  return null;
};

export const serveFavicon = async (pageUrl: unknown, res: ServerResponse) => {
  let host: string;
  let origin: string;
  try {
    const u = new URL(String(pageUrl || ""));
    if (!/^https?:$/.test(u.protocol)) throw new Error("bad protocol");
    host = u.hostname;
    origin = u.origin;
  } catch { res.writeHead(400); res.end(); return; }

  const safeHost = host.replace(/[^a-z0-9.-]/gi, "_");
  const send = (file: string) => {
    const ext = String(file.split(".").pop() || "");
    res.writeHead(200, { "content-type": TYPE_BY_EXT[ext] || "application/octet-stream", "cache-control": "private, max-age=86400" });
    res.end(fs.readFileSync(file));
  };

  const cached = EXTS.map((ext) => path.join(DIR, `${safeHost}.${ext}`)).find((p) => fs.existsSync(p));
  if (cached) return send(cached);
  if ((misses.get(safeHost) || 0) > Date.now()) { res.writeHead(404); res.end(); return; }

  let got = await fetchBytes(`${origin}/favicon.ico`);
  let ext = got ? sniffExt(got.buf, got.type) : null;
  if (!ext) {
    const iconUrl = await findHtmlIcon(origin);
    got = iconUrl ? await fetchBytes(iconUrl) : null;
    ext = got ? sniffExt(got.buf, got.type) : null;
  }
  if (!got || !ext) {
    misses.set(safeHost, Date.now() + 3600_000);
    res.writeHead(404); res.end();
    return;
  }
  fs.mkdirSync(DIR, { recursive: true });
  const file = path.join(DIR, `${safeHost}.${ext}`);
  fs.writeFileSync(file, got.buf);
  return send(file);
};

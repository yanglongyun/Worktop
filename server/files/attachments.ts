import { DATA_HOME } from "../system/paths.js";
// 附件上传、内容寻址存储与原始字节读取。
import { createHash } from "crypto";
import { mkdirSync, readFileSync, statSync, writeFileSync } from "fs";
import type { ServerResponse } from "http";
import { basename, extname, join } from "path";

/** 附件元数据:落库与随消息传的就是这一份,不含字节。 */
type Attachment = {
  id: string;
  name: string;
  path: string;
  mimeType: string;
  size: number;
  url: string;
};

const ROOT = join(DATA_HOME, "files");

export const MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024;
const MAX_PER_MESSAGE = 10;

const IMAGE_TYPES = new Map([
  [".png", "image/png"], [".jpg", "image/jpeg"], [".jpeg", "image/jpeg"],
  [".gif", "image/gif"], [".webp", "image/webp"],
]);
const IMAGE_EXTENSIONS = new Map([...IMAGE_TYPES].map(([ext, mime]) => [mime, ext === ".jpeg" ? ".jpg" : ext]));

const safeName = (value: unknown) => basename(String(value || "file")).replace(/[^\p{L}\p{N}._ -]/gu, "_").slice(0, 120) || "file";

/** 元数据归一:只认 files 根下的内容寻址文件名,路径逃逸直接拒绝。 */
const normalize = (input: any): Attachment | null => {
  const file = basename(String(input?.id || ""));
  if (!file) return null;
  const path = join(ROOT, file);
  if (!path.startsWith(`${ROOT}/`)) return null;
  return {
    id: file,
    name: safeName(input?.name || file),
    path,
    mimeType: String(input?.mimeType || "application/octet-stream"),
    size: Number(input?.size) || 0,
    url: `/api/files/attachments/${encodeURIComponent(file)}`,
  };
};

/** 上传:{name, mimeType, dataBase64} → 附件元数据。同内容天然去重(SHA-256 命名)。 */
export const upload = (input: any) => {
  const bytes = Buffer.from(String(input?.dataBase64 || ""), "base64");
  if (!bytes.length) throw new Error("文件内容为空");
  if (bytes.length > MAX_ATTACHMENT_BYTES) throw new Error(`文件不能超过 ${Math.floor(MAX_ATTACHMENT_BYTES / 1024 / 1024)}MB`);
  let name = safeName(input?.name);
  let ext = extname(name).toLowerCase().slice(0, 12);
  if (!IMAGE_TYPES.has(ext) && IMAGE_EXTENSIONS.has(input?.mimeType)) {
    ext = IMAGE_EXTENSIONS.get(input.mimeType)!;
    name = `${name.replace(/\.[^.]*$/, "")}${ext}`;
  }
  const id = `${createHash("sha256").update(bytes).digest("hex")}${ext}`;
  mkdirSync(ROOT, { recursive: true });
  try { writeFileSync(join(ROOT, id), bytes, { flag: "wx" }); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
  return normalize({ id, name, mimeType: IMAGE_TYPES.get(ext) || String(input?.mimeType || "application/octet-stream"), size: bytes.length });
};

/** 一条消息随附的附件数组归一(数量上限 + 逐个校验)。 */
export const normalizeMany = (values: unknown): Attachment[] => {
  if (!Array.isArray(values)) return [];
  if (values.length > MAX_PER_MESSAGE) throw new Error(`每条消息最多 ${MAX_PER_MESSAGE} 个文件`);
  return values.map(normalize).filter((a): a is Attachment => a !== null);
};

/** GET /api/files/attachments/<id>:按内容寻址名回吐字节。 */
export const serve = (id: unknown, res: ServerResponse) => {
  const file = normalize({ id });
  if (!file) return false;
  try {
    const info = statSync(file.path);
    res.writeHead(200, {
      "content-type": IMAGE_TYPES.get(extname(file.path).toLowerCase()) || "application/octet-stream",
      "content-length": info.size,
      "cache-control": "private, max-age=31536000, immutable",
    });
    res.end(readFileSync(file.path));
    return true;
  } catch { return false; }
};

import { DATA_HOME } from "../home.js";
// 附件:图片与文件上传的整套数据链路(与 AGENT 0.0.4 同源,按 worktop 结构落位)。
//
//   - 上传内容按 SHA-256 存入 $WORKTOP_HOME/files;消息与 SQLite 只存元数据
//     (id / 名称 / 路径 / 类型 / 大小),不存 Base64;
//   - 请求 Responses API 时,**当前这条**用户消息的图片才展开成 input_image,
//     普通文件作为可读取的本地路径交给模型(read/bash 都能碰);
//   - read 工具读到的图片(function_call_output.image)只在当前轮内展开,
//     最多 MAX_LIVE_TOOL_IMAGES 张 —— 旧轮次不反复携带图片字节。
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

const MAX_BYTES = 8 * 1024 * 1024;
const MAX_PER_MESSAGE = 10;
const MAX_LIVE_TOOL_IMAGES = 2;

const IMAGE_TYPES = new Map([
  [".png", "image/png"], [".jpg", "image/jpeg"], [".jpeg", "image/jpeg"],
  [".gif", "image/gif"], [".webp", "image/webp"],
]);
const IMAGE_EXTENSIONS = new Map([...IMAGE_TYPES].map(([ext, mime]) => [mime, ext === ".jpeg" ? ".jpg" : ext]));

const safeName = (value: unknown) => basename(String(value || "file")).replace(/[^\p{L}\p{N}._ -]/gu, "_").slice(0, 120) || "file";

const dataUrl = (image: { path: string; mimeType: string }) => {
  const bytes = readFileSync(image.path);
  return `data:${image.mimeType};base64,${bytes.toString("base64")}`;
};

/** 元数据归一:只认 files 根下的内容寻址文件名,路径逃逸直接拒绝。 */
const normalize = (input: any): Attachment | null => {
  const file = basename(String(input?.file || input?.id || ""));
  if (!file) return null;
  const path = join(ROOT, file);
  if (!path.startsWith(`${ROOT}/`)) return null;
  return {
    id: file,
    name: safeName(input?.name || file),
    path,
    mimeType: String(input?.mimeType || "application/octet-stream"),
    size: Number(input?.size) || 0,
    url: `/api/files/${encodeURIComponent(file)}`,
  };
};

/** 上传:{name, mimeType, dataBase64} → 附件元数据。同内容天然去重(SHA-256 命名)。 */
export const upload = (input: any) => {
  const bytes = Buffer.from(String(input?.dataBase64 || ""), "base64");
  if (!bytes.length) throw new Error("文件内容为空");
  if (bytes.length > MAX_BYTES) throw new Error(`文件不能超过 ${Math.floor(MAX_BYTES / 1024 / 1024)}MB`);
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
  return normalize({ file: id, name, mimeType: IMAGE_TYPES.get(ext) || String(input?.mimeType || "application/octet-stream"), size: bytes.length });
};

/** 一条消息随附的附件数组归一(数量上限 + 逐个校验)。 */
export const normalizeMany = (values: unknown): Attachment[] => {
  if (!Array.isArray(values)) return [];
  if (values.length > MAX_PER_MESSAGE) throw new Error(`每条消息最多 ${MAX_PER_MESSAGE} 个文件`);
  return values.map(normalize).filter((a): a is Attachment => a !== null);
};

/** GET /api/files/<id>:按内容寻址名回吐字节。 */
export const serve = (id: unknown, res: ServerResponse) => {
  const file = normalize({ file: id });
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

/**
 * 请求前的输入整形(注入内核的 prepareInput):
 *   - 最后一条用户消息的附件:图片展开 input_image,其余给本地路径;
 *   - 当前轮(最后一条用户消息之后)的工具图片:最多展开 MAX_LIVE_TOOL_IMAGES 张;
 *   - 其余条目剥掉 attachments / image 字段 —— 旧轮不携带图片字节,协议也不认这些字段。
 */
export const prepareInput = async (items: any[]) => {
  const lastUser = items.reduce((found: number, item: any, index: number) => (item?.role === "user" ? index : found), -1);
  let toolImages = 0;
  const output: any[] = [];
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    if (index === lastUser && item?.attachments?.length) {
      const parts: any[] = [];
      const text = typeof item.content === "string" ? item.content : "";
      if (text) parts.push({ type: "input_text", text });
      for (const attachment of item.attachments) {
        if (String(attachment.mimeType).startsWith("image/") && attachment.size <= MAX_BYTES) {
          parts.push({ type: "input_image", image_url: dataUrl(attachment) });
        } else {
          parts.push({ type: "input_text", text: `[本地文件: ${attachment.name}\n路径: ${attachment.path}]` });
        }
      }
      output.unshift({ role: "user", content: parts });
    } else if (item?.type === "function_call_output" && item.image && index > lastUser && toolImages < MAX_LIVE_TOOL_IMAGES) {
      toolImages += 1;
      output.unshift({ type: item.type, call_id: item.call_id, output: [
        { type: "input_text", text: String(item.output || "") },
        { type: "input_image", image_url: dataUrl(item.image) },
      ] });
    } else if (item?.attachments || item?.image) {
      const clean = { ...item };
      delete clean.attachments;
      delete clean.image;
      output.unshift(clean);
    } else {
      output.unshift(item);
    }
  }
  return output;
};

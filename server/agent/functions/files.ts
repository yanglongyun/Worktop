// @ts-nocheck
// 文件三件套:read(有界读,带行号,图片交给模型看)/ edit(精确替换)/ write(带护栏写)。
// 相对路径从本轮默认起点解析;绝对路径和 ~/ 可直接定位本地文件。
//
// 正确性口径(与 AGENT 0.0.7 对齐):
//   - read/edit 统一按 LF 匹配,写回还原原始行尾 —— CRLF 文件的多行替换不再必败;
//   - edit 按下标切片拼接,不走 String.replace —— new 里的 $&/$`/$'/$n/$$ 不再被
//     当替换模式解释而静默写错文件;
//   - read 的行数不把尾随换行切出的空串算作一行。
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "fs";
import { dirname, extname } from "path";
import { resolveLocalPath } from "../paths.js";

const IMAGE_TYPES = new Map([
  [".png", "image/png"], [".jpg", "image/jpeg"], [".jpeg", "image/jpeg"],
  [".gif", "image/gif"], [".webp", "image/webp"],
]);

const resolvePath = (value, ctx) => resolveLocalPath(String(value || ""), ctx?.cwd);

export const readDef = {
  type: "function",
  name: "read",
  description:
    "读取一个文本文件,返回带行号的内容(便于随后用 edit 精确定位)。大文件用 offset/limit 分页。" +
    "支持绝对路径与 ~/;相对路径从本轮默认起点解析。",
  parameters: {
    type: "object",
    properties: {
      summary: { type: "string", description: "一句话说明为什么读(界面会显示)" },
      path: { type: "string", description: "文件路径(绝对路径、~/ 或相对路径)" },
      offset: { type: "number", description: "可选:从第几行开始读(1 起)" },
      limit: { type: "number", description: "可选:读多少行(默认 2000,上限 2000)" },
    },
    required: ["summary", "path"],
    additionalProperties: false,
  },
};

export const read = ({ path: p, offset, limit }, ctx) => {
  const abs = resolvePath(p, ctx);
  let stat;
  try { stat = statSync(abs); } catch { return `error: 文件不存在: ${p}`; }
  if (stat.isDirectory()) return `error: ${p} 是目录(列目录用 bash 的 ls)`;

  // 图片:不按文本读,作为图像交给模型查看(当前轮由附件层展开成 input_image)
  const imageType = IMAGE_TYPES.get(extname(abs).toLowerCase());
  if (imageType) {
    if (stat.size > 8 * 1024 * 1024) return `error: 图片过大(${Math.round(stat.size / 1024 / 1024)}MB,上限 8MB)`;
    return {
      output: `(图片 ${p},${imageType},${Math.round(stat.size / 1024)} KB —— 已作为图像交给你查看)`,
      image: { path: abs, mimeType: imageType, size: stat.size },
    };
  }

  if (stat.size > 5_000_000) return `error: 文件过大(${stat.size} 字节),请用 bash 处理`;
  let buf;
  try { buf = readFileSync(abs); } catch (e) { return `error: ${e.message}`; }
  if (buf.subarray(0, 8192).includes(0)) return `(二进制文件,${stat.size} 字节,无法按文本读)`;
  // 按 LF 返回,和 edit 的匹配口径一致,行尾的 \r 不会漏给模型
  const lines = toLf(buf.toString("utf8")).split("\n");
  // 以换行结尾的文件会切出一个尾随空串,它不是一行,否则行号整体多 1
  if (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();
  const start = Math.max(1, Number(offset) || 1);
  const count = Math.min(Number(limit) || 2000, 2000);
  const slice = lines.slice(start - 1, start - 1 + count);
  if (!slice.length) return `(超出文件范围,共 ${lines.length} 行)`;
  // 按字符预算在**行边界**收口:read 的结果绝不落进装配层的通用截断 ——
  // 那个策略是留头留尾挖中间(为 bash 日志设计),用在带行号的文件上,
  // 模型会看到中段凭空消失,误以为文件残缺,还无法精确续读。
  // 这里超预算就整行停下,并给出准确的 offset 续读点。
  const budget = Math.max(2000, (Number(ctx?.toolResultMaxChars) || 12000) - 200);
  const numbered = [];
  let used = 0;
  for (let index = 0; index < slice.length; index += 1) {
    const line = `${String(start + index).padStart(5)}\t${slice[index]}`;
    if (numbered.length > 0 && used + line.length + 1 > budget) break;
    numbered.push(line);
    used += line.length + 1;
  }
  const included = numbered.length;
  const rest = lines.length - (start - 1 + included);
  return numbered.join("\n") + (rest > 0 ? `\n… (还有 ${rest} 行,用 offset=${start + included} 继续读)` : "");
};

export const editDef = {
  type: "function",
  name: "edit",
  description:
    "精确替换文件里的一段文本:把 old 替换成 new。old 必须在文件里唯一匹配(否则报错,请带更长上下文)。" +
    "改文件首选 —— 比 bash sed / 重写整文件可靠且省 token。需替换多处可设 replace_all。",
  parameters: {
    type: "object",
    properties: {
      summary: { type: "string", description: "一句话说明为什么改(界面会显示)" },
      path: { type: "string", description: "文件路径" },
      old: { type: "string", description: "要被替换的原文(需在文件中唯一)" },
      new: { type: "string", description: "替换成的新文本" },
      replace_all: { type: "boolean", description: "可选:替换所有匹配(默认只替换唯一一处)" },
    },
    required: ["summary", "path", "old", "new"],
    additionalProperties: false,
  },
};

export const edit = ({ path: p, old, new: next, replace_all }, ctx) => {
  if (old == null || old === "") return "error: old(要替换的原文)不能为空";
  const abs = resolvePath(p, ctx);
  let raw;
  try { raw = readFileSync(abs, "utf8"); } catch { return `error: 读不到文件: ${p}`; }

  // 匹配前统一归一到 LF(read 给模型的就是 LF),写回前还原原始行尾
  const ending = detectLineEnding(raw);
  const content = toLf(raw);
  const oldStr = toLf(String(old));
  const newStr = toLf(String(next ?? ""));

  const occurrences = content.split(oldStr).length - 1;
  if (occurrences === 0) return "error: 没找到要替换的内容(old 在文件里不存在)。先用 read 确认原文。";
  if (occurrences > 1 && !replace_all) return `error: old 出现了 ${occurrences} 次,不唯一。请带上更长、唯一的上下文,或设 replace_all=true。`;

  // 按下标切片拼接,不走 String.replace —— new 里的 $& / $` / $' / $n / $$ 原样写入
  let updated;
  if (replace_all) {
    updated = content.split(oldStr).join(newStr);
  } else {
    const at = content.indexOf(oldStr);
    updated = content.slice(0, at) + newStr + content.slice(at + oldStr.length);
  }

  try { writeFileSync(abs, restoreLineEnding(updated, ending)); } catch (e) { return `error: 写回失败 ${e.message}`; }
  ctx.emit?.({ type: "tree_changed", reason: "edit", paths: [abs] });
  return `已编辑 ${p}(替换 ${replace_all ? occurrences : 1} 处)`;
};

export const writeDef = {
  type: "function",
  name: "write",
  description:
    "把 content 写入文件(不存在则创建,父目录自动创建;存在则覆盖)。新建文件或整体重写时用它;只改局部请用 edit。",
  parameters: {
    type: "object",
    properties: {
      summary: { type: "string", description: "一句话说明为什么写(界面会显示)" },
      path: { type: "string", description: "文件路径" },
      content: { type: "string", description: "文件内容" },
    },
    required: ["summary", "path", "content"],
    additionalProperties: false,
  },
};

export const write = ({ path: p, content }, ctx) => {
  if (!p) return "error: path 不能为空";
  const abs = resolvePath(p, ctx);
  const existed = existsSync(abs);
  try {
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content != null ? String(content) : "");
  } catch (e) { return `error: ${e.message}`; }
  ctx.emit?.({ type: "tree_changed", reason: "write", paths: [abs] });
  const bytes = Buffer.byteLength(content != null ? String(content) : "");
  return `${existed ? "已覆盖" : "已创建"} ${p}(${bytes} 字节)`;
};

// ---- 行尾:模型看到的和 edit 用来匹配的必须是同一套(只处理 CRLF,孤立的 \r 原样保留)----
function detectLineEnding(content: string) {
  const crlf = content.indexOf("\r\n");
  if (crlf === -1) return "\n";
  const lf = content.indexOf("\n");
  // CRLF 里的 \n 位于 \r 之后一位;若首个 \n 更靠前,说明文件以 LF 为主。
  return crlf < lf ? "\r\n" : "\n";
}

/** CRLF → LF。 */
function toLf(text: string) {
  return text.includes("\r\n") ? text.replace(/\r\n/g, "\n") : text;
}

/** LF → 原始行尾。 */
function restoreLineEnding(text: string, ending: string) {
  return ending === "\r\n" ? text.replace(/\n/g, "\r\n") : text;
}

import { readFileSync } from "node:fs";
import { MAX_ATTACHMENT_BYTES } from "../files/attachments.js";

const MAX_LIVE_TOOL_IMAGES = 2;

const dataUrl = (image: { path: string; mimeType: string }) => {
  const bytes = readFileSync(image.path);
  return `data:${image.mimeType};base64,${bytes.toString("base64")}`;
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
        if (String(attachment.mimeType).startsWith("image/") && attachment.size <= MAX_ATTACHMENT_BYTES) {
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

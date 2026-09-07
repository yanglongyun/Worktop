import os from "node:os";
import path from "node:path";
import { statSync } from "node:fs";

/** 本地路径按本轮执行位置解析,不依赖对话或文件面板。 */
export const resolveLocalPath = (value: string, base = os.homedir()) => {
  if (value === "~") return os.homedir();
  if (value.startsWith("~/")) return path.resolve(os.homedir(), value.slice(2));
  return path.resolve(base, value);
};

/** 显式指定的执行目录必须存在,不静默切换到其他位置。 */
export const executionDirectory = (value?: string) => {
  const directory = resolveLocalPath(value || "~");
  if (!statSync(directory).isDirectory()) throw new Error(`不是文件夹: ${directory}`);
  return directory;
};

/** 仅计算产物路径;真正写入文件时才建目录。 */
export const outputDirectory = (chatId: string) => path.join(os.homedir(), "worktop", "outputs", path.basename(chatId));

/** 交互式终端也可从明确选中的文件所在目录启动。 */
export const terminalDirectory = (value = "") => {
  const absolute = resolveLocalPath(value || "~");
  return statSync(absolute).isDirectory() ? absolute : path.dirname(absolute);
};

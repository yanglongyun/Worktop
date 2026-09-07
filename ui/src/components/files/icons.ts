import type { FileNode } from "../../api/files";
import { Folder, FileText, FileCode, FileJson, Image, Hash, FileType } from "../ui/icons";

// 按扩展名挑文件图标(VSCode 风)
const iconByExtension = (title: string) => {
  const ext = title.split(".").pop()?.toLowerCase() || "";
  if (["ts", "tsx", "js", "jsx", "mjs", "cjs", "py", "go", "rs", "java", "c", "cpp", "sh"].includes(ext)) return FileCode;
  if (["html", "htm", "xml", "vue", "svelte", "css", "scss", "less"].includes(ext)) return FileCode;
  if (ext === "json") return FileJson;
  if (["md", "markdown"].includes(ext)) return Hash;
  if (["png", "jpg", "jpeg", "gif", "svg", "webp", "ico", "bmp", "avif"].includes(ext)) return Image;
  if (["txt", "log"].includes(ext)) return FileType;
  return FileText;
};

export const fileIconFor = (kind: FileNode["kind"], title?: string) =>
  kind === "folder" ? Folder : title ? iconByExtension(title) : FileText;
export const fileColorFor = (kind: FileNode["kind"]) =>
  kind === "folder" ? "text-accent" : "text-text-faint";

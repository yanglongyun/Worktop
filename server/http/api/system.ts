// 原生系统交互。
import { execFile } from "node:child_process";
import nodePath from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import * as tree from "../../files/service.js";
import { pickDirectory } from "../../system/directoryPicker.js";
import { attempt, json } from "./helpers.js";

export const handleSystemRoutes = async (_req: IncomingMessage, res: ServerResponse, url: URL, method: string): Promise<boolean> => {
  const path = url.pathname;
  const id = () => String(url.searchParams.get("id") || "");
  if (path === "/api/system/directory/pick" && method === "POST") return attempt(res, 200, async () => ({ path: await pickDirectory() }));
  // 在系统文件管理器里显示文件或文件夹。
  if (path === "/api/system/reveal" && method === "POST") {
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

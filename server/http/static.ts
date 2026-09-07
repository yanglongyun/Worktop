import { REPO_ROOT } from "../system/paths.js";
import fs from "fs";
import path from "path";

// WORKTOP_UI_DIST:打包 app 里前端在只读资源区;开发态就在仓库根的 ui/dist。
const DIST = path.resolve(process.env.WORKTOP_UI_DIST || path.join(REPO_ROOT, "ui/dist"));

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};

const isFile = (p: string) => { try { return fs.statSync(p).isFile(); } catch { return false; } };

const serve = (res: import("http").ServerResponse, pathname: string) => {
  const index = path.join(DIST, "index.html");
  if (!isFile(index)) {
    res.writeHead(503, { "Content-Type": "text/plain" });
    res.end("GUI not built. Run: npm run build\n");
    return;
  }
  const target = path.normalize(path.join(DIST, pathname === "/" ? "/index.html" : pathname));
  if (!target.startsWith(DIST)) { res.writeHead(400); res.end(); return; }
  if (isFile(target)) {
    const ext = path.extname(target).toLowerCase();
    res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
    res.end(fs.readFileSync(target));
    return;
  }
  // SPA fallback
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(fs.readFileSync(index));
};

export { serve };

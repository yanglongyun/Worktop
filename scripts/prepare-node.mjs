// 把当前 node 复制进 dist/node-runtime,随包分发。
// 打包的 app 用它跑 server sidecar:node-pty 的 N-API prebuild 对上官方 node,零 ABI 纠纷。
// macOS 产物叫 node,Windows 叫 node.exe;壳按平台取名(desktop/main.js)。
import { chmodSync, copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "dist/node-runtime");
const name = process.platform === "win32" ? "node.exe" : "node";

mkdirSync(OUT, { recursive: true });
copyFileSync(process.execPath, join(OUT, name));
if (process.platform !== "win32") chmodSync(join(OUT, name), 0o755);
console.log(`node runtime: ${process.execPath} → dist/node-runtime/${name}(${process.version})`);

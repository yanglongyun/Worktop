// 打 server 与 updater 两个 bundle。banner 放在这里而不是 npm script 里:
// 那段带引号的 --banner:js 在 Windows 的 cmd 下会被转义吃掉。
import { build } from "esbuild";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const banner = { js: "import{createRequire as __cr}from'node:module';const require=__cr(import.meta.url);" };
const which = process.argv[2] || "server";

if (which === "server") {
  await build({
    entryPoints: [join(ROOT, "index.ts")], bundle: true, platform: "node", format: "esm",
    outfile: join(ROOT, "dist/server.mjs"), external: ["node-pty", "bufferutil", "utf-8-validate"], banner,
  });
} else if (which === "updater") {
  await build({
    entryPoints: [join(ROOT, "desktop/updater-src.mjs")], bundle: true, platform: "node", format: "esm",
    outfile: join(ROOT, "desktop/updater.mjs"), external: ["electron"], banner,
  });
} else throw new Error(`不认识的目标:${which}`);

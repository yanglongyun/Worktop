// desktop/icon.svg → desktop/icon.icns(macOS)+ desktop/icon.png(512,通用)。
// sharp 先在 1024 栅格化一次,再各尺寸缩放;iconutil 收成 icns。
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SVG = join(ROOT, "desktop/icon.svg");
const SET = join(ROOT, "dist/icon.iconset");

// iconutil 认的文件名 → 像素尺寸
const SLOTS = [
  ["icon_16x16.png", 16], ["icon_16x16@2x.png", 32],
  ["icon_32x32.png", 32], ["icon_32x32@2x.png", 64],
  ["icon_128x128.png", 128], ["icon_128x128@2x.png", 256],
  ["icon_256x256.png", 256], ["icon_256x256@2x.png", 512],
  ["icon_512x512.png", 512], ["icon_512x512@2x.png", 1024],
];

rmSync(SET, { recursive: true, force: true });
mkdirSync(SET, { recursive: true });

const master = await sharp(SVG, { density: 72 }).resize(1024, 1024).png().toBuffer();
for (const [name, size] of SLOTS) {
  await sharp(master).resize(size, size).png().toFile(join(SET, name));
}
await sharp(master).resize(512, 512).png().toFile(join(ROOT, "desktop/icon.png"));

if (process.platform === "darwin") {
  execFileSync("iconutil", ["-c", "icns", SET, "-o", join(ROOT, "desktop/icon.icns")]);
  console.log("icon: desktop/icon.icns + desktop/icon.png 已生成");
} else {
  // Windows 用 electron-builder 从 512 png 自己生成 ico;icns 只有 macOS 能收
  console.log("icon: desktop/icon.png 已生成(非 macOS 不出 icns)");
}
rmSync(SET, { recursive: true, force: true });

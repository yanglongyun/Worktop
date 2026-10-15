// 下载按钮从更新清单里读版本与文件名 —— 清单是发布的唯一真相,页面不另外维护版本号。
// 清单还没上传时按钮退化成 GitHub Releases 链接(HTML 里的默认 href)。
// 安装包和清单在 worktop 自己的桶里,经本站的 /download/ 给出
const R2 = "/download";

type Manifest = { version: string; file: string };
const parse = (yml: string, ext: string): Manifest | null => {
  const version = yml.match(/^version:\s*(.+)$/m)?.[1]?.trim() || "";
  const file = yml.match(new RegExp(`^\\s*-?\\s*url:\\s*(.+\\.${ext})\\s*$`, "m"))?.[1]?.trim() || "";
  return version && file ? { version, file } : null;
};
const load = async (path: string, ext: string) => {
  try {
    const r = await fetch(`${R2}/${path}`, { cache: "no-store" });
    return r.ok ? parse(await r.text(), ext) : null;
  } catch { return null; }
};

const wire = (id: string, base: string, m: Manifest | null) => {
  const a = document.getElementById(id) as HTMLAnchorElement | null;
  if (!a || !m) return;
  a.href = `${R2}/${base}/${m.file}`;
};

void (async () => {
  const [mac, win] = await Promise.all([load("mac-arm64/latest-mac.yml", "dmg"), load("win-x64/latest.yml", "exe")]);
  wire("dl-mac", "mac-arm64", mac);
  wire("dl-win", "win-x64", win);
  const meta = document.getElementById("dl-meta");
  const v = mac?.version || win?.version;
  if (meta && v) meta.textContent = `v${v} · MIT License · 自动更新`;
})();

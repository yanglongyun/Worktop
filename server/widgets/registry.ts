import { REPO_ROOT, productHome } from "../system/paths.js";
// 组件注册表:组件 = 组件的家里的一个目录。契约是出厂技能 resources/skills/widget/SKILL.md。
//
//   <家>/widgets/<id>/
//     widget.json   manifest(名字/图标/权限)
//     index.html    入口
//     *.js *.css    随便几个,浏览器直接吃(零构建)
//     data.db       组件自己的数据,和代码做邻居
//
// 「安装」= 目录存在(扫描自动注册);「卸载」= 目录挪进 .trash(保留 30 天)。
// 组件的家是产品自己的地盘(~/.worktop/widgets),不往用户的工作区里塞东西。
import fs from "fs";
import path from "path";

const RESOURCES = process.env.WORKTOP_RESOURCES || path.join(REPO_ROOT, "resources");

const WIDGET_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
const PERMISSIONS = ["sql", "ai", "net"] as const; // ui 免申请

type WidgetInfo = {
  id: string;
  name: string;
  icon: string;
  description: string;
  permissions: string[];
  hosts: string[]; // net 权限的域名白名单,宿主代理只放行这些
  position: number; // 列表排序,小的在前;没写的排最后
  dir: string;
};

/** 组件的家:~/.worktop/widgets。 */
export const widgetsHome = () => path.join(productHome(), "widgets");
const trashDir = () => path.join(widgetsHome(), ".trash");

const readManifest = (dir: string): WidgetInfo | null => {
  const id = path.basename(dir).toLowerCase();
  if (!WIDGET_ID.test(id)) return null;
  if (!fs.existsSync(path.join(dir, "index.html"))) return null; // 入口必备
  let raw: any = {};
  try { raw = JSON.parse(fs.readFileSync(path.join(dir, "widget.json"), "utf8")); } catch { /* 没有 manifest 也认,全用缺省 */ }
  const declared = Array.isArray(raw?.permissions) ? raw.permissions.map((p: unknown) => String(p)) : [];
  return {
    id,
    name: String(raw?.name || id).slice(0, 32),
    icon: String(raw?.icon || "📦").slice(0, 8),
    description: String(raw?.description || "").slice(0, 200),
    permissions: declared.filter((p: string) => (PERMISSIONS as readonly string[]).includes(p)),
    hosts: Array.isArray(raw?.hosts) ? raw.hosts.map((h: unknown) => String(h).toLowerCase()).slice(0, 16) : [],
    position: Number.isFinite(raw?.position) ? Number(raw.position) : 1000,
    dir,
  };
};

export const listWidgets = (): WidgetInfo[] => {
  const home = widgetsHome();
  let entries: fs.Dirent[];
  try { entries = fs.readdirSync(home, { withFileTypes: true }); } catch { return []; }
  const out: WidgetInfo[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith(".") || entry.name.startsWith("_")) continue;
    const widget = readManifest(path.join(home, entry.name));
    if (widget) out.push(widget);
  }
  return out.sort((a, b) => a.position - b.position || a.name.localeCompare(b.name, "zh"));
};

export const getWidget = (id: string): WidgetInfo | null =>
  (WIDGET_ID.test(String(id || "")) ? listWidgets().find((w) => w.id === id) || null : null);

export const widgetDbPath = (id: string) => {
  const widget = getWidget(id);
  return widget ? path.join(widget.dir, "data.db") : null;
};

/** 组件目录里的一个文件(路径穿越防护 + 大小上限)。 */
export const widgetFile = (id: string, rel: string): { buf: Buffer; ext: string } | null => {
  const widget = getWidget(id);
  if (!widget) return null;
  const base = path.resolve(widget.dir);
  const abs = path.resolve(base, rel.replace(/^\/+/, ""));
  if (abs !== base && !abs.startsWith(base + path.sep)) return null;
  if (/(^|[/\\])data\.db(-wal|-shm)?$/.test(abs)) return null; // 数据库只经 /widgets/sql,不当静态文件发
  try {
    const stat = fs.statSync(abs);
    if (!stat.isFile() || stat.size > 20 * 1024 * 1024) return null;
    return { buf: fs.readFileSync(abs), ext: (path.extname(abs).slice(1) || "").toLowerCase() };
  } catch { return null; }
};

/** 卸载 = 挪进回收站(保留 30 天),不是直接删 —— 用户删的是小工具,不是三个月的记录。 */
export const trashWidget = (id: string) => {
  const widget = getWidget(id);
  if (!widget) throw new Error("组件不存在");
  const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
  const target = path.join(trashDir(), `${widget.id}-${stamp}`);
  fs.mkdirSync(trashDir(), { recursive: true });
  fs.renameSync(widget.dir, target);
  return target;
};

/** 回收站清理:超过 30 天的真删。启动时跑一次。 */
export const sweepTrash = () => {
  const cutoff = Date.now() - 30 * 24 * 3600 * 1000;
  let entries: fs.Dirent[];
  try { entries = fs.readdirSync(trashDir(), { withFileTypes: true }); } catch { return; }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const abs = path.join(trashDir(), entry.name);
    try {
      if (fs.statSync(abs).mtimeMs < cutoff) fs.rmSync(abs, { recursive: true, force: true });
    } catch { /* 下次再说 */ }
  }
};

/** 预装组件落地:出厂模板复制进组件的家,之后就是用户自己的组件(可改可删)。
 *  目录已存在就整个跳过 —— 绝不覆盖用户改过的代码,更不覆盖 data.db。 */
export const seedPresetWidgets = () => {
  const home = widgetsHome();
  const presetDir = path.join(RESOURCES, "widgets");
  let entries: fs.Dirent[];
  try { entries = fs.readdirSync(presetDir, { withFileTypes: true }); } catch { return; }
  fs.mkdirSync(home, { recursive: true });
  // 组件目录默认不把数据提交进版本库
  const gitignore = path.join(home, ".gitignore");
  if (!fs.existsSync(gitignore)) {
    try { fs.writeFileSync(gitignore, "data.db\ndata.db-wal\ndata.db-shm\n.trash/\n"); } catch { /* 无所谓 */ }
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const target = path.join(home, entry.name);
    if (fs.existsSync(target)) continue;
    try {
      fs.cpSync(path.join(presetDir, entry.name), target, { recursive: true });
      console.log(`[widgets] 预装组件已落地:widgets/${entry.name}`);
    } catch (e: any) {
      console.error(`[widgets] 落地失败 ${entry.name}:`, e?.message);
    }
  }
};

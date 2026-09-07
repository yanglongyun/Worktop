import { REPO_ROOT, productHome } from "../system/paths.js";
// 应用注册表:app = 应用的家里的一个目录(契约见仓库根 APP.md)。
//
//   <家>/apps/<id>/
//     manifest.json   声明:是什么、怎么跑、要什么
//     APP.md          文档:给模型读的 API 表(渐进披露,常驻提示词只放一行)
//     icon.svg        可选
//     (实现)          随便什么语言、框架、构建方式
//
// **这是跨宿主的公共标准,不是我们自己的东西** —— AGENT 仓库同一份契约。
// 组件(widgets)才是我们特有的:零构建、宿主给数据库、关在侧栏里。
// 两者并存,分工见 .dev/1.2.0/README.md。
//
// 每次问都重扫:十几个小 JSON 的开销可忽略,换来 AI 刚写完一个 app、
// 刷新就出现在列表里,不必重启宿主。
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, watch } from "node:fs";
import path from "node:path";
import { emit } from "../bus.js";

const ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,31}$/;
const DEFAULT_HEALTH = "/health";
const RUN_MODES = ["on-demand", "always"] as const;
const IDLE_TIMEOUT_MS = 600_000;

type AppRun = {
  command: string;
  args: string[];
  health: string;
  mode: (typeof RUN_MODES)[number];
  idleTimeoutMs: number;
};

export type AppDef = {
  id: string;
  dir: string;
  name: string;
  version: string;
  description: string;
  iconFile: string;
  permissions: string[];
  run: AppRun | null;
  hasDoc: boolean;
  /** 非空 = 这个目录有问题,列表里要显示原因,而不是假装它不存在。 */
  invalid: string;
};

const asString = (value: unknown, fallback = "") =>
  (typeof value === "string" ? value.trim() : fallback);

/** 应用的家:~/.worktop/apps(与 widgets 并列)。产品自己的东西,不混进用户的文件夹。 */
export const appsHome = () => path.join(productHome(), "apps");

/** 随包的出厂应用。 */
const presetDir = () =>
  path.join(process.env.WORKTOP_RESOURCES || path.join(REPO_ROOT, "resources"), "apps");

/** 出厂应用落地:复制进应用的家,之后就是用户自己的 app(可改可删)。
 *  目录已存在就整个跳过 —— 绝不覆盖用户改过的代码,更不覆盖它的数据。 */
export const seedPresetApps = () => {
  const home = appsHome();
  let entries;
  try { entries = readdirSync(presetDir(), { withFileTypes: true }); } catch { return; }
  mkdirSync(home, { recursive: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const target = path.join(home, entry.name);
    if (existsSync(target)) continue;
    try {
      cpSync(path.join(presetDir(), entry.name), target, { recursive: true });
      console.log(`[apps] 出厂应用已落地:apps/${entry.name}`);
    } catch (e: any) {
      console.error(`[apps] 落地失败 ${entry.name}:`, e?.message);
    }
  }
};

/** 应用数据:宿主建好目录交给 app,app 只管往里写(APP_DATA_DIR)。 */
export const appDataHome = () => path.join(appsHome(), ".data");

/** 读一个目录,永远返回一条记录 —— 坏 app 也要能在列表里看见原因。 */
const readOne = (id: string): AppDef | null => {
  const dir = path.join(appsHome(), id);
  const manifestFile = path.join(dir, "manifest.json");
  const iconFile = ["icon.svg", "icon.png"].map((n) => path.join(dir, n)).find(existsSync) || "";
  const base: AppDef = {
    id, dir, name: id, version: "", description: "",
    iconFile, permissions: [], run: null,
    hasDoc: existsSync(path.join(dir, "APP.md")), invalid: "",
  };

  if (!ID_PATTERN.test(id)) return { ...base, invalid: "目录名只能是小写字母、数字和连字符" };
  if (!existsSync(manifestFile)) return null; // 不是 app,静默跳过

  let raw: any;
  try { raw = JSON.parse(readFileSync(manifestFile, "utf8")); }
  catch (e: any) { return { ...base, invalid: `manifest.json 解析失败:${String(e?.message || e)}` }; }
  if (asString(raw.id) !== id) {
    return { ...base, invalid: `manifest.id(${asString(raw.id) || "空"})与目录名不一致` };
  }

  const def: AppDef = {
    ...base,
    name: asString(raw.name) || id,
    version: asString(raw.version),
    description: asString(raw.description),
    permissions: Array.isArray(raw.permissions) ? raw.permissions.map(String) : [],
  };

  if (raw.run && asString(raw.run.command)) {
    const mode = asString(raw.run.mode, "on-demand") as AppRun["mode"];
    if (!RUN_MODES.includes(mode)) {
      return { ...def, invalid: `run.mode 只能是 ${RUN_MODES.join(" / ")}` };
    }
    def.run = {
      command: asString(raw.run.command),
      args: Array.isArray(raw.run.args) ? raw.run.args.map(String) : [],
      health: asString(raw.run.health) || DEFAULT_HEALTH,
      mode,
      idleTimeoutMs: IDLE_TIMEOUT_MS,
    };
  } else if (!existsSync(path.join(dir, "index.html"))) {
    // 纯静态 app 的约定:目录根就是站点根
    def.invalid = "没有 run 也没有 index.html —— 这个目录还不是一个 app";
  }
  return def;
};

export const listApps = (): AppDef[] => {
  const home = appsHome();
  if (!existsSync(home)) return [];
  return readdirSync(home)
    .filter((name) => !name.startsWith(".") && statSync(path.join(home, name)).isDirectory())
    .map(readOne)
    .filter((a): a is AppDef => !!a)
    .sort((a, b) => a.name.localeCompare(b.name, "zh"));
};

export const getApp = (id: string): AppDef | null =>
  listApps().find((a) => a.id === String(id || "")) || null;

export const readAppDoc = (id: string): string => {
  try { return readFileSync(path.join(appsHome(), String(id), "APP.md"), "utf8"); }
  catch { return ""; }
};

/** 目录一变就通知界面。非递归就够:新 app 一定是新建一个子目录。 */
export const watchApps = () => {
  const home = appsHome();
  if (!existsSync(home)) return;
  let timer: NodeJS.Timeout | null = null;
  try {
    watch(home, { persistent: false }, () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => emit({ type: "apps_changed" }), 250);
    });
  } catch { /* 某些文件系统不支持 watch,退化成刷新才更新 */ }
};

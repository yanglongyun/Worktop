// @ts-nocheck
// 文件系统即树 —— 而且**只有**文件系统的东西:
//   目录     = 文件夹(folder)—— 唯一会无限自嵌套的容器
//   真实文件 = 文件(file)—— 内容就是文件内容
//
// 对话单独保存在 SQLite;文件夹改名、移动、删除不影响对话。
// id 规则:folder / file = 绝对路径(改名/移动即变,前端重拉,无需 fs↔DB 同步)。

import fs from "fs";
import os from "os";
import path from "path";
import { listRoots, setRootTitle } from "./roots.js";

// 常用目录 = 用户手动添加的文件夹,可以多个,记在 file_roots 表里;默认一个都没有。
// 产品自己的东西(应用/组件/它们的数据)住 ~/.worktop,不混进用户的文件夹。
const SEP = path.sep;


// 对话正文里的路径常写成 ~/…(模型和用户都这么写),点开时也要认
const expandHome = (p) => (p === "~" || p.startsWith("~/")) ? path.join(os.homedir(), p.slice(1)) : p;
const isPathId = (id) => typeof id === "string" && (id.startsWith("/") || id.startsWith("~/"));
const normalizeAbs = (p) => path.resolve(expandHome(String(p || "").trim()));
const withSep = (abs) => abs.endsWith(SEP) ? abs : abs + SEP;
const isUnder = (abs, root) => abs === root || abs.startsWith(withSep(root));
const rootPaths = () => listRoots().map((r) => r.path);
/** 文件树操作的默认位置:第一个已添加文件夹,没有则使用主目录。 */
const defaultDir = () => rootPaths()[0] || os.homedir();
const rootOf = (abs) => {
  const full = normalizeAbs(abs);
  return rootPaths()
    .filter((root) => isUnder(full, root))
    .sort((a, b) => b.length - a.length)[0] || null;
};
const isFileRoot = (abs) => rootOf(abs) === normalizeAbs(abs);
const rootForPath = (abs) => listRoots().find((r) => r.path === normalizeAbs(abs)) || null;
const parentAbsOf = (abs) => isFileRoot(abs) ? null : path.dirname(normalizeAbs(abs));
// 点开头不等于隐藏:.dev / .github / .gitignore 都是要看的(VS Code 同款语义)。
// 真正藏起来的只有系统噪音文件;噪音目录走 IGNORE_DIRS(.git 在其中)。
const IGNORE_FILES = new Set([".DS_Store", "Thumbs.db", "desktop.ini"]);
// SQLite 的附属文件(应用 data.db 旁边那两个)不上树:一个库显示三个文件纯属噪音
const isHidden = (name) => IGNORE_FILES.has(name) || /\.(db|sqlite)-(wal|shm)$/.test(name);
// 递归(搜索 / 删除子树)时跳过的重目录 —— 跟 VSCode 一样不索引它们,
// 否则 AI 一 npm install,node_modules 几万文件会拖垮一切。
const IGNORE_DIRS = new Set([
  "node_modules", "dist", "build", "release", "out", "target", "vendor",
  ".git", ".next", ".cache", ".turbo", ".gradle", ".venv", "__pycache__",
]);
// macOS 的「包」目录(.app / 照片库 …)里面是成千上万个内部文件,树里当一个整体,不往里走
const isBundle = (name) => /\.(app|framework|bundle|photoslibrary|musiclibrary|tvlibrary|xcodeproj)$/i.test(name);
// 允许 .dev 这类点开头的名字;只挡路径分隔符和 "." / ".." 两个特殊目录名
const sanitize = (title) => {
  const t = String(title || "").trim().replace(/[/\\]/g, "-");
  return (t === "." || t === ".." ? "" : t) || "未命名";
};

const statCreatedAt = (abs) => {
  try { const s = fs.statSync(abs); return new Date(s.birthtimeMs || s.mtimeMs).toISOString(); }
  catch { return null; }
};

// ── 构造统一 item ──
const folderNode = (abs) => {
  const full = normalizeAbs(abs);
  const root = isFileRoot(full) ? rootForPath(full) : null;
  return {
    id: full, parent_id: parentAbsOf(full), kind: "folder",
    title: root?.title || path.basename(full), created_at: null,
    isRoot: !!root,
  };
};
const MAX_TEXT = 2_000_000;
const fileNode = (abs, withContent = false) => {
  const node = {
    id: abs, parent_id: parentAbsOf(abs), kind: "file",
    title: path.basename(abs), content: null, created_at: null,
    size: 0, binary: false, tooLarge: false,
  };
  if (!withContent) return node;
  node.created_at = statCreatedAt(abs);
  try { node.size = fs.statSync(abs).size; } catch {}
  if (node.size > MAX_TEXT) { node.tooLarge = true; return node; }
  let buf; try { buf = fs.readFileSync(abs); } catch { return node; }
  if (buf.subarray(0, 8192).includes(0)) { node.binary = true; return node; } // 二进制(NUL 字节)
  node.content = buf.toString("utf8");
  return node;
};

// 把 file id 解析成磁盘绝对路径(给 /api/files/raw 用);非文件返回 null
const resolveFileAbs = (id) => {
  const hit = locate(id);
  return hit && hit.kind === "file" ? hit.abs : null;
};

// 任意节点 → 磁盘绝对路径(文件夹=目录,文件=文件)。仅常用目录内有效。
const pathForId = (id) => { const hit = locate(id); return hit ? hit.abs : null; };

// 递归列出整棵树所有节点(给 ⌘P 快速打开用),跳过 IGNORE_DIRS / 包 / 隐藏。不读文件内容。
// 这是同步遍历,跑在主线程上:常用目录一大(桌面下几个仓库)就是几十万项、几分钟,
// 期间整个服务端对谁都不应答。所以封顶 —— 筛选够用就行,不追求全量。
const LIST_ALL_CAP = 20_000;
const listAll = () => {
  const out = [];
  const walk = (dir) => {
    if (out.length >= LIST_ALL_CAP) return;
    let entries; try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (out.length >= LIST_ALL_CAP) return;
      if (isHidden(e.name)) continue;
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) { if (!IGNORE_DIRS.has(e.name) && !isBundle(e.name)) { out.push(folderNode(abs)); walk(abs); } }
      else out.push(fileNode(abs));
    }
  };
  for (const root of rootPaths()) {
    out.push(folderNode(root));
    walk(root);
  }
  return out;
};

// ── 定位 id 在磁盘上是什么 → { kind, abs } ──
const locate = (id) => {
  if (id == null || id === "") return null;
  const sid = String(id);
  if (!isPathId(sid)) return null; // 非路径 id(如对话 uuid)不归这棵树管
  const abs = normalizeAbs(sid);
  // 任何真实存在的路径都能定位、打开 —— 文件根只是文件树的入口,不是能不能打开的边界。
  // AI 的产物默认写在 ~/worktop/outputs/ 下,不加根也要能点开;本机应用里 bash 本就能读写任意文件,再设围栏只会制造「打不开自己刚写的文件」这种 bug。
  let st; try { st = fs.statSync(abs); } catch { return null; }
  return { kind: st.isDirectory() ? "folder" : "file", abs };
};

// ════════════════ 公开 API(统一树 facade)════════════════

const listChildren = (parentId) => {
  let dirAbs;
  if (!parentId) {
    const out = listRoots().map((row) => folderNode(row.path));
    return out;
  }
  else {
    const hit = locate(parentId);
    if (!hit || hit.kind !== "folder") return [];
    dirAbs = hit.abs;
  }
  let entries; try { entries = fs.readdirSync(dirAbs, { withFileTypes: true }); } catch { return []; }
  const out = [];
  for (const e of entries) {
    if (isHidden(e.name)) continue;
    const abs = path.join(dirAbs, e.name);
    if (e.isDirectory()) out.push(folderNode(abs));
    else out.push(fileNode(abs));
  }
  // 排序:普通文件管理器规则 —— 文件夹在前,同类按名(不给任何文件特权)
  const rank = (n) => (n.kind === "folder" ? 1 : 2);
  out.sort((a, b) => rank(a) - rank(b) || a.title.localeCompare(b.title, undefined, { sensitivity: "base" }));
  return out;
};

const getItem = (id) => {
  const hit = locate(id);
  if (!hit) return null;
  if (hit.kind === "folder") return folderNode(hit.abs);
  return fileNode(hit.abs, true);
};

const createItem = ({ kind, parentId = null, title, content = null }) => {
  let parentDir;
  if (parentId) {
    const hit = locate(parentId);
    if (!hit || hit.kind !== "folder") throw new Error(`父级必须是文件夹: ${parentId}`);
    parentDir = hit.abs;
  } else parentDir = defaultDir();

  if (kind === "folder") {
    const abs = path.join(parentDir, sanitize(title));
    fs.mkdirSync(abs, { recursive: true });
    return folderNode(abs);
  }
  if (kind === "file") {
    const abs = path.join(parentDir, sanitize(title));
    fs.writeFileSync(abs, content != null ? String(content) : "");
    return fileNode(abs, true);
  }
  throw new Error(`未知类型: ${kind}`);
};

const updateItem = (id, { title, content, overwrite = false } = {}) => {
  const hit = locate(id);
  if (!hit) throw new Error(`not found: ${id}`);

  // 改名撞上同名:默认报错;overwrite=true 时旧的进废纸篓,不静默覆盖
  const renameGuard = (next) => {
    if (!fs.existsSync(next)) return;
    if (!overwrite) throw new Error(`目标已有同名:${path.basename(next)}`);
    trashItem(next);
  };

  if (hit.kind === "folder" && isFileRoot(hit.abs)) {
    if (title !== undefined) {
      setRootTitle(hit.abs, title);
    }
    return folderNode(hit.abs);
  }

  if (hit.kind === "file") {
    let abs = hit.abs;
    if (content !== undefined) fs.writeFileSync(abs, content == null ? "" : String(content));
    if (title !== undefined) {
      const next = path.join(path.dirname(abs), sanitize(title));
      if (next !== abs) { renameGuard(next); fs.renameSync(abs, next); abs = next; }
    }
    return fileNode(abs, true);
  }
  // folder:改名 = 目录改名
  let abs = hit.abs;
  if (title !== undefined) {
    const next = path.join(path.dirname(abs), sanitize(title));
    if (next !== abs) { renameGuard(next); fs.renameSync(abs, next); abs = next; }
  }
  return folderNode(abs);
};

/** 删除走废纸篓:macOS 移入 ~/.Trash(重名加时间戳),跨卷/失败或非 mac 退回永久删。 */
const trashItem = (abs) => {
  if (process.platform === "darwin") {
    try {
      const trash = path.join(process.env.HOME || "", ".Trash");
      fs.mkdirSync(trash, { recursive: true });
      let dest = path.join(trash, path.basename(abs));
      if (fs.existsSync(dest)) {
        const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "").replace("T", "-");
        const parsed = path.parse(path.basename(abs));
        dest = path.join(trash, `${parsed.name} ${stamp}${parsed.ext}`);
      }
      fs.renameSync(abs, dest);
      return true;
    } catch { /* 跨卷 EXDEV / 权限 → 永久删兜底 */ }
  }
  fs.rmSync(abs, { recursive: true, force: true });
  return false;
};

const deleteItem = (id) => {
  const hit = locate(id);
  if (!hit) return;
  if (hit.kind === "file") { trashItem(hit.abs); return; }
  if (isFileRoot(hit.abs)) throw new Error("请从文件面板移除这个文件夹");
  trashItem(hit.abs);
};

/** 目标目录里找一个不冲突的名字:name → name copy → name copy 2 …(带扩展名的插在扩展名前)。 */
const uniqueDest = (dir, name) => {
  let candidate = path.join(dir, name);
  if (!fs.existsSync(candidate)) return candidate;
  const parsed = path.parse(name);
  for (let i = 1; i < 100; i += 1) {
    const suffix = i === 1 ? " copy" : ` copy ${i}`;
    candidate = path.join(dir, `${parsed.name}${suffix}${parsed.ext}`);
    if (!fs.existsSync(candidate)) return candidate;
  }
  throw new Error("重名副本太多");
};

// 复制到某空间下(targetParentId 缺省 = 原地出副本)。重名自动 「name copy」。
const copyItem = (id, targetParentId = null) => {
  const hit = locate(id);
  if (!hit) throw new Error(`not found: ${id}`);
  if (hit.kind === "folder" && isFileRoot(hit.abs)) throw new Error("常用根目录不能复制");
  let targetDir;
  if (targetParentId) {
    const ph = locate(targetParentId);
    if (!ph || ph.kind !== "folder") throw new Error("目标必须是一个文件夹");
    targetDir = ph.abs;
  } else targetDir = path.dirname(hit.abs);
  if (hit.kind === "folder" && (targetDir === hit.abs || targetDir.startsWith(withSep(hit.abs)))) {
    throw new Error("不能把文件夹复制进自己的子孙");
  }
  const dest = uniqueDest(targetDir, path.basename(hit.abs));
  fs.cpSync(hit.abs, dest, { recursive: true });
  return hit.kind === "folder" ? folderNode(dest) : fileNode(dest, true);
};

// 移到某空间下(newParentId 必须是空间或 null=根)。
// 目标已有同名:默认报错,overwrite=true 时把旧的送进废纸篓再落位(不静默覆盖)。
const moveItem = (id, newParentId, overwrite = false) => {
  const hit = locate(id);
  if (!hit) throw new Error(`not found: ${id}`);
  if (hit.kind === "folder" && isFileRoot(hit.abs)) throw new Error("常用根目录不能移动");
  let targetDir;
  if (newParentId) {
    const ph = locate(newParentId);
    if (!ph || ph.kind !== "folder") throw new Error("目标必须是一个文件夹");
    targetDir = ph.abs;
  } else targetDir = defaultDir();

  if (hit.kind === "folder") {
    if (targetDir === hit.abs || targetDir.startsWith(withSep(hit.abs))) throw new Error("不能把文件夹移进自己的子孙");
  }
  const next = path.join(targetDir, path.basename(hit.abs));
  if (next !== hit.abs) {
    if (fs.existsSync(next)) {
      if (!overwrite) throw new Error(`目标已有同名:${path.basename(next)}`);
      trashItem(next);
    }
    fs.renameSync(hit.abs, next);
  }
  if (hit.kind === "folder") return folderNode(next);
  return fileNode(next, true);
};

/** 外部拖入导入:把浏览器读到的文件内容落到 parentId 目录下(relPath 可带子目录)。 */
const importFile = ({ parentId = null, relPath, dataBase64 }) => {
  let baseDir;
  if (parentId) {
    const hit = locate(parentId);
    if (!hit || hit.kind !== "folder") throw new Error("目标必须是一个文件夹");
    baseDir = hit.abs;
  } else baseDir = defaultDir();
  const rel = String(relPath || "").split("/").map((seg) => sanitize(seg)).filter(Boolean);
  if (!rel.length) throw new Error("文件名为空");
  const dir = path.join(baseDir, ...rel.slice(0, -1));
  fs.mkdirSync(dir, { recursive: true });
  const dest = uniqueDest(dir, rel[rel.length - 1]);
  fs.writeFileSync(dest, Buffer.from(String(dataBase64 || ""), "base64"));
  return fileNode(dest, true);
};

export {
  IGNORE_DIRS,
  listChildren, listAll, getItem, createItem, updateItem, deleteItem, moveItem, copyItem, importFile,
  resolveFileAbs, pathForId,
};

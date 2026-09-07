// 网站收藏:侧栏「网站」页的数据。一棵树 —— 文件夹可以无限嵌套,同级可拖动排序。
// 打开动作全在界面(<webview> 标签),这里只管数据。
import { randomUUID } from "crypto";
import { getDb } from "../database/connection.js";
import { emit } from "../bus.js";

const changed = () => emit({ type: "sites_changed" });

type BookmarkRow = {
  id: string;
  title: string;
  url: string;
  kind: "site" | "folder";
  parent_id: string | null;
  position: number;
  created_at: string;
};

const normalizeUrl = (raw: unknown) => {
  const value = String(raw || "").trim();
  if (!value) throw new Error("url is required");
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(value) ? value : `https://${value}`;
  const parsed = new URL(withScheme); // 非法直接抛
  if (!/^https?:$/.test(parsed.protocol)) throw new Error("只支持 http(s) 链接");
  return parsed.toString();
};

/** 按层级与次序取全表。界面自己拼树 —— 层级浅,不值得在 SQL 里递归。 */
const list = () =>
  getDb().prepare("SELECT * FROM browser_bookmarks ORDER BY position, created_at, rowid").all() as unknown as BookmarkRow[];

/** 站点身份键:规范化后的完整 url(书签是按页面存的,同一个站的不同页面是不同条目)。 */
const siteKey = (normalized: string) => normalized.replace(/\/$/, "");
const nextPosition = (parentId: string | null) => {
  const row = getDb()
    .prepare("SELECT COALESCE(MAX(position), -1) + 1 AS p FROM browser_bookmarks WHERE parent_id IS ?")
    .get(parentId) as { p: number };
  return row.p;
};

const create = ({ url, title, parentId }: { url?: string; title?: string; parentId?: string | null } = {}) => {
  const normalized = normalizeUrl(url);
  // 同一个 url 已收藏:直接返回已有条目,不重复插行(去重跨文件夹 —— 一条书签只该存在一次)
  const key = siteKey(normalized);
  const existing = list().find((row) => {
    if (row.kind !== "site") return false;
    try { return siteKey(normalizeUrl(row.url)) === key; } catch { return false; }
  });
  if (existing) return existing;

  const id = randomUUID();
  const name = String(title || "").trim() || new URL(normalized).hostname.replace(/^www\./, "");
  const parent = parentId || null;
  getDb()
    .prepare("INSERT INTO browser_bookmarks (id, title, url, kind, parent_id, position) VALUES (?, ?, ?, 'site', ?, ?)")
    .run(id, name, normalized, parent, nextPosition(parent));
  changed();
  return getDb().prepare("SELECT * FROM browser_bookmarks WHERE id = ?").get(id) as unknown as BookmarkRow;
};

const createFolder = ({ title, parentId }: { title?: string; parentId?: string | null } = {}) => {
  const name = String(title || "").trim() || "新文件夹";
  const id = randomUUID();
  const parent = parentId || null;
  getDb()
    .prepare("INSERT INTO browser_bookmarks (id, title, url, kind, parent_id, position) VALUES (?, ?, '', 'folder', ?, ?)")
    .run(id, name, parent, nextPosition(parent));
  changed();
  return getDb().prepare("SELECT * FROM browser_bookmarks WHERE id = ?").get(id) as unknown as BookmarkRow;
};

const update = (id: string, { title, url }: { title?: string; url?: string } = {}) => {
  const db = getDb();
  const row = db.prepare("SELECT * FROM browser_bookmarks WHERE id = ?").get(String(id)) as unknown as BookmarkRow | undefined;
  if (!row) throw new Error("没有这一条");
  const nextTitle = title === undefined ? row.title : String(title).trim() || row.title;
  // 文件夹没有 url,改它没有意义 —— 静默忽略比报错好,界面本来也不会给这个入口
  const nextUrl = row.kind === "folder" ? "" : (url === undefined ? row.url : normalizeUrl(url));
  db.prepare("UPDATE browser_bookmarks SET title = ?, url = ? WHERE id = ?").run(nextTitle, nextUrl, row.id);
  changed();
  return db.prepare("SELECT * FROM browser_bookmarks WHERE id = ?").get(row.id) as unknown as BookmarkRow;
};

/**
 * 重排 / 移动:一次把某个父层下的完整顺序发过来。
 *
 * 顺序与归属一起改 —— 拖进文件夹和拖动次序在界面上是同一个手势,
 * 拆成两个接口的话中间那一刻的状态是错的。
 */
/** target 是不是 folderId 自己或它的后代。 */
const isWithin = (target: string, folderId: string, known: Map<string, BookmarkRow>) => {
  let cur: string | null = target;
  for (let i = 0; cur && i < 64; i++) {
    if (cur === folderId) return true;
    cur = known.get(cur)?.parent_id ?? null;
  }
  return false;
};

const reorder = ({ parentId, ids }: { parentId?: string | null; ids?: unknown } = {}) => {
  const db = getDb();
  const parent = parentId || null;
  const wanted = (Array.isArray(ids) ? ids : []).map(String);
  const known = new Map(list().map((row) => [row.id, row]));
  const write = db.prepare("UPDATE browser_bookmarks SET parent_id = ?, position = ? WHERE id = ?");

  let index = 0;
  for (const id of wanted) {
    const row = known.get(id);
    if (!row) continue;
    // 文件夹不能套进自己或自己的后代
    if (row.kind === "folder" && parent && isWithin(parent, row.id, known)) continue;
    write.run(parent, index, id);
    index += 1;
  }
  changed();
  return list();
};

const remove = (id: string) => {
  const db = getDb();
  const row = db.prepare("SELECT * FROM browser_bookmarks WHERE id = ?").get(String(id)) as unknown as BookmarkRow | undefined;
  if (!row) return false;
  // 删文件夹 = 整棵子树一起删(界面上会先说清楚里面有多少条收藏)
  const ids = [row.id];
  for (let i = 0; i < ids.length; i++) {
    const kids = db.prepare("SELECT id FROM browser_bookmarks WHERE parent_id = ?").all(ids[i]) as unknown as { id: string }[];
    for (const k of kids) ids.push(k.id);
  }
  const del = db.prepare("DELETE FROM browser_bookmarks WHERE id = ?");
  for (const id of ids) del.run(id);
  changed();
  return true;
};

export { list, create, createFolder, update, reorder, remove };

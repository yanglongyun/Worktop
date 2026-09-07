// @ts-nocheck
// 对话与消息保存在 SQLite,与文件浏览和执行路径独立。
// 对话住 SQLite,不落进用户的资产目录 —— 它是过程,不是用户的文件。
// uuid 稳定寻址(messages / compactions 都按它)。
import { randomUUID } from "crypto";
import { getDb } from "../database/connection.js";

// 新对话默认叫这个;首条消息跑完后由 runs 层请模型取正式名字
const DEFAULT_TITLE = "未命名对话";

const now = () => getDb().prepare("SELECT datetime('now') AS t").get().t;

/** 行 → 对话形状(kind='chat'),UI 的标签页/聊天面板吃它。 */
const toChat = (row) => row && ({
  id: row.id,
  kind: "chat",
  title: row.title,
  system: row.system ?? null,
  pinned: !!row.pinned,
  last_read_at: row.last_read_at ?? null,
  created_at: row.created_at,
  updated_at: row.updated_at,
});

const getChat = (id) => toChat(getDb().prepare("SELECT * FROM chats WHERE id = ?").get(String(id || "")));

/** 只列用户自己的会话 —— 应用触发的任务在「任务」里看,不混进这份清单。 */
const listChats = () =>
  getDb().prepare("SELECT * FROM chats WHERE origin_app IS NULL ORDER BY pinned DESC, updated_at DESC, created_at DESC").all().map(toChat);

/** item 里的纯文本(与界面 thread.ts 的 itemText 同口径)。 */
const itemText = (item) => {
  if (typeof item?.content === "string") return item.content;
  if (!Array.isArray(item?.content)) return "";
  return item.content
    .filter((part) => part?.type === "output_text" || part?.type === "input_text")
    .map((part) => String(part?.text || ""))
    .join("");
};

/**
 * 每个对话「最后说了什么」:给会话列表的预览行用。
 *
 * 只认**用户消息**与**助手正文** —— 思考、工具调用、工具结果、系统告示都跳过:
 * 列表要回答的是「这段对话聊到哪了」,不是「后台跑了什么」。
 * 每个对话最多回溯 30 条:一轮里工具调用可能很密,但正文不会埋得太深。
 */
const lastMessages = (ids) => {
  if (!ids.length) return {};
  const db = getDb();
  const out = {};
  const stmt = db.prepare(
    "SELECT body, meta, created_at FROM messages WHERE chat_id = ? ORDER BY id DESC LIMIT 30",
  );
  for (const id of ids) {
    for (const row of stmt.all(String(id))) {
      let item;
      try { item = JSON.parse(row.body); } catch { continue; }
      // 工具调用/结果/思考:没有 role 或 role 非 user/assistant,一律跳过
      const role = item?.role;
      if (role !== "user" && role !== "assistant") continue;
      // 系统注入的压缩摘要、跨对话调用回执等不是「人说的话」
      let meta = {};
      try { meta = row.meta ? JSON.parse(row.meta) : {}; } catch { /* 无 meta */ }
      const kind = String(meta.kind || meta.source || "");
      if (kind === "compaction" || kind === "call" || kind === "call_result") continue;
      const text = itemText(item).trim().replace(/\s+/g, " ");
      if (!text) continue;
      out[id] = { role, text: text.slice(0, 200), at: row.created_at };
      break;
    }
  }
  return out;
};

const createChat = ({ title, system = null, originApp = null } = {}) => {
  const id = randomUUID();
  getDb().prepare(`
    INSERT INTO chats (id, origin_app, title, system) VALUES (?, ?, ?, ?)
  `).run(id, originApp == null ? null : String(originApp),
    String(title || DEFAULT_TITLE).trim() || DEFAULT_TITLE, system == null ? null : String(system));
  return getChat(id);
};

const updateChat = (id, { title, system, pinned } = {}) => {
  const db = getDb();
  if (title !== undefined) db.prepare("UPDATE chats SET title = ? WHERE id = ?").run(String(title || "").trim() || DEFAULT_TITLE, String(id));
  if (system !== undefined) db.prepare("UPDATE chats SET system = ? WHERE id = ?").run(system == null ? null : String(system), String(id));
  if (pinned !== undefined) db.prepare("UPDATE chats SET pinned = ? WHERE id = ?").run(pinned ? 1 : 0, String(id));
  return getChat(id);
};

/** 邮箱有动静:浮到最近组顶部。 */
const touchChat = (id) => { getDb().prepare("UPDATE chats SET updated_at = ? WHERE id = ?").run(now(), String(id)); };

const markRead = (id) => {
  getDb().prepare("UPDATE chats SET last_read_at = ? WHERE id = ?").run(now(), String(id));
  return getChat(id);
};

/** 删除:记录 + 邮箱 + 调用关系一起走,不留孤儿。 */
const deleteChat = (id) => {
  const db = getDb();
  // messages / compactions 由外键 ON DELETE CASCADE 带走
  return db.prepare("DELETE FROM chats WHERE id = ?").run(String(id)).changes > 0;
};

/** 一组 id → { id: 有未读 }(有比 last_read_at 更新的消息)。 */
const unreadMap = (ids) => {
  if (!ids?.length) return {};
  const db = getDb();
  const ph = ids.map(() => "?").join(",");
  const latest = {};
  for (const r of db.prepare(`SELECT chat_id, MAX(created_at) AS m FROM messages WHERE chat_id IN (${ph}) GROUP BY chat_id`).all(...ids.map(String))) {
    latest[r.chat_id] = r.m;
  }
  const reads = {};
  for (const r of db.prepare(`SELECT id, last_read_at FROM chats WHERE id IN (${ph})`).all(...ids.map(String))) {
    reads[r.id] = r.last_read_at || null;
  }
  const map = {};
  for (const id of ids) {
    const m = latest[String(id)] || null;
    const lr = reads[String(id)] ?? null;
    map[id] = !!(m && (!lr || m > lr));
  }
  return map;
};

export {
  DEFAULT_TITLE,
  listChats, getChat, createChat, updateChat, deleteChat,
  markRead, touchChat, unreadMap, lastMessages,
};

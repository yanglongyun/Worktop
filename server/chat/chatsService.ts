// 对话服务:repo 之上的业务层 —— 富化未读、广播 chats_changed。
import * as repo from "./chats.js";
import { emit } from "../bus.js";

const changed = () => emit({ type: "chats_changed" });

// 注:repo/chats.ts 尚未脱 @ts-nocheck,推断类型过窄;边界处收口,repo 脱敏后移除。
type ChatPatch = { title?: string; system?: string | null; pinned?: boolean };

const list = () => {
  const rows = repo.listChats() as any[];
  const ids = rows.map((r) => r.id);
  const unread = repo.unreadMap(ids) as Record<string, boolean>;
  // 最后一句:会话列表的「最后消息」显示项要用(用户可在列表里逐项勾选显示什么)
  const last = repo.lastMessages(ids) as Record<string, { role: string; text: string; at: string }>;
  return rows.map((r) => ({ ...r, unread: !!unread[r.id], last: last[r.id] || null }));
};

const get = (id: string) => {
  const row = repo.getChat(id) as any;
  if (!row) return null;
  return { ...row, unread: !!(repo.unreadMap([row.id]) as Record<string, boolean>)[row.id] };
};

const create = ({ title, system = null }: ChatPatch = {}) => {
  const item = repo.createChat({ title, system } as any);
  changed();
  return item;
};

const update = (id: string, patch: ChatPatch = {}) => {
  const item = repo.updateChat(id, patch as any);
  changed();
  return item;
};

const remove = (id: string) => {
  const ok = repo.deleteChat(id);
  changed();
  return ok;
};

const markRead = (id: string) => repo.markRead(id);

export { list, get, create, update, remove, markRead };

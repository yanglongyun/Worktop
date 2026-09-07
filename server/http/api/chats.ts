// 会话:列表 / 建 / 改 / 删 / 单个 / 已读,某个会话的消息流,谁在跑。
import type { IncomingMessage, ServerResponse } from "node:http";
import { listApprovals, respondApproval } from "../../chats/approvals.js";
import * as chats from "../../chats/service.js";
import { listRows } from "../../chats/messages.js";
import { runningIds } from "../../chats/turn.js";
import { attempt, json, parseBody } from "./helpers.js";

export const handleChatsRoutes = async (req: IncomingMessage, res: ServerResponse, url: URL, method: string): Promise<boolean> => {
  const path = url.pathname;
  if (path === "/api/chats") {
    if (method === "GET") { json(res, 200, { ok: true, chats: chats.list() }); return true; }
    if (method === "POST") return attempt(res, 201, async () => ({ item: chats.create(await parseBody(req)) }));
    if (method === "PATCH") return attempt(res, 200, async () => ({ item: chats.update(String(url.searchParams.get("id") || ""), await parseBody(req)) }));
    if (method === "DELETE") {
      const id = url.searchParams.get("id");
      if (!id) { json(res, 400, { ok: false, error: "id is required" }); return true; }
      json(res, 200, { ok: true, deleted: chats.remove(id) }); return true;
    }
  }
  if (path === "/api/chats/get" && method === "GET") {
    const item = chats.get(String(url.searchParams.get("id") || ""));
    if (!item) { json(res, 404, { ok: false, error: "not found" }); return true; }
    json(res, 200, { ok: true, item }); return true;
  }
  if (path === "/api/chats/read" && method === "POST") {
    json(res, 200, { ok: true, item: chats.markRead(String(url.searchParams.get("id") || "")) }); return true;
  }
  // 某个会话的邮箱
  if (path === "/api/chats/messages" && method === "GET") {
    json(res, 200, { ok: true, rows: listRows(String(url.searchParams.get("chatId") || "")) }); return true;
  }
  // 谁在跑(界面初始化对账;实时靠 conversation.* 事件)
  if (path === "/api/chats/runs" && method === "GET") { json(res, 200, { ok: true, ids: runningIds() }); return true; }
  // 刷新页面后把还悬着的卡捞回来,否则用户永远等不到那张卡
  if (path === "/api/chats/approvals" && method === "GET") {
    json(res, 200, { approvals: listApprovals(String(url.searchParams.get("chatId") || "")) });
    return true;
  }
  if (path === "/api/chats/approvals" && method === "POST") {
    const body = await parseBody(req);
    json(res, 200, { ok: respondApproval(String(body.id), String(body.answer)) });
    return true;
  }
  return false;
};

// 规则的路由面:规则 CRUD + 提醒卡表态 + 捞回悬着的卡。
import type { IncomingMessage, ServerResponse } from "node:http";
import { listApprovals, respondApproval } from "../../chat/approvals.js";
import { createRule, deleteRule, listRules, reorderRules, updateRule } from "../../chat/rules.js";

import { json, parseBody } from "./helpers.js";

export const handlePermissionRoutes = async (
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  method: string,
): Promise<boolean> => {
  const p = url.pathname;

  if (p === "/api/rules" && method === "GET") {
    json(res, 200, { rules: listRules() });
    return true;
  }
  if (p === "/api/rules" && method === "POST") {
    const body = await parseBody(req);
    const text = String(body.text || "").trim();
    if (!text) { json(res, 400, { error: "内容为空" }); return true; }
    json(res, 201, { rule: createRule(text) });
    return true;
  }
  if (p === "/api/rules" && method === "PATCH") {
    const body = await parseBody(req);
    const id = String(url.searchParams.get("id") || body.id || "");
    const patch: { text?: string; enabled?: boolean } = {};
    if (typeof body.text === "string") {
      const text = body.text.trim();
      if (!text) { json(res, 400, { error: "内容为空" }); return true; }
      patch.text = text;
    }
    if (typeof body.enabled === "boolean") patch.enabled = body.enabled;
    const rule = updateRule(id, patch);
    if (!rule) { json(res, 404, { error: "没有这条规则" }); return true; }
    json(res, 200, { rule });
    return true;
  }
  // 重排:整份顺序一次发过来,服务端照单重写 position
  if (p === "/api/rules/order" && method === "POST") {
    const body = await parseBody(req);
    json(res, 200, { rules: reorderRules(body.ids) });
    return true;
  }
  if (p === "/api/rules" && method === "DELETE") {
    json(res, 200, { deleted: deleteRule(String(url.searchParams.get("id") || "")) });
    return true;
  }

  // 刷新页面后把还悬着的卡捞回来,否则用户永远等不到那张卡
  if (p === "/api/approvals" && method === "GET") {
    json(res, 200, { approvals: listApprovals(String(url.searchParams.get("chatId") || "")) });
    return true;
  }
  if (p === "/api/approvals" && method === "POST") {
    const body = await parseBody(req);
    json(res, 200, { ok: respondApproval(String(body.id), String(body.answer)) });
    return true;
  }
  return false;
};

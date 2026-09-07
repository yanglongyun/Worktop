// 设置:模型连接、默认提示词、压缩水位等。
import type { IncomingMessage, ServerResponse } from "node:http";
import { createRule, deleteRule, listRules, reorderRules, updateRule } from "../../settings/rules.js";
import { DEFAULT_PROMPTS } from "../../settings/defaults.js";
import { getSettings, saveSettings } from "../../settings/store.js";
import { json, parseBody } from "./helpers.js";

export const handleSettingsRoutes = async (req: IncomingMessage, res: ServerResponse, url: URL, method: string): Promise<boolean> => {
  const p = url.pathname;
  if (p === "/api/settings/rules" && method === "GET") {
    json(res, 200, { rules: listRules() });
    return true;
  }
  if (p === "/api/settings/rules" && method === "POST") {
    const body = await parseBody(req);
    const text = String(body.text || "").trim();
    if (!text) { json(res, 400, { error: "内容为空" }); return true; }
    json(res, 201, { rule: createRule(text) });
    return true;
  }
  if (p === "/api/settings/rules" && method === "PATCH") {
    const body = await parseBody(req);
    const id = String(url.searchParams.get("id") || "");
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
  if (p === "/api/settings/rules/order" && method === "POST") {
    const body = await parseBody(req);
    json(res, 200, { rules: reorderRules(body.ids) });
    return true;
  }
  if (p === "/api/settings/rules" && method === "DELETE") {
    json(res, 200, { deleted: deleteRule(String(url.searchParams.get("id") || "")) });
    return true;
  }

  if (p !== "/api/settings") return false;
  if (method === "GET") { json(res, 200, { ok: true, settings: getSettings(), promptDefaults: DEFAULT_PROMPTS }); return true; }
  if (method === "POST") { json(res, 200, { ok: true, settings: saveSettings(await parseBody(req)) }); return true; }
  return false;
};

// 技能的路由面:列表 / 开关 / 读 SKILL.md。技能本身是产品家目录里的文件,这里不建不删。
import type { IncomingMessage, ServerResponse } from "node:http";
import { listProductSkills, readSkillDoc, setSkillEnabled } from "../../skills/registry.js";

import { json, parseBody } from "./helpers.js";

export const handleSkillsRoutes = async (req: IncomingMessage, res: ServerResponse, url: URL, method: string) => {
  const p = url.pathname;
  if (!p.startsWith("/api/skills")) return false;

  if (p === "/api/skills" && method === "GET") {
    json(res, 200, { ok: true, skills: listProductSkills() });
    return true;
  }
  if (p === "/api/skills/toggle" && method === "POST") {
    const body = await parseBody(req);
    try {
      setSkillEnabled(String(body.id || ""), body.enabled !== false);
      json(res, 200, { ok: true });
    } catch (e: any) {
      json(res, 400, { ok: false, error: e?.message || "开关失败" });
    }
    return true;
  }
  if (p === "/api/skills/doc" && method === "GET") {
    const id = String(url.searchParams.get("id") || "");
    const content = readSkillDoc(id);
    if (content === null) { json(res, 404, { ok: false, error: "技能不存在" }); return true; }
    json(res, 200, { ok: true, id, content });
    return true;
  }
  json(res, 404, { ok: false, error: "not found" });
  return true;
};

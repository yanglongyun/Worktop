import { request, jsonBody } from "../lib/http";

export type SkillInfo = { id: string; name: string; description: string; path: string; enabled: boolean };

export const skillsApi = {
  listSkills: () => request<{ skills: SkillInfo[] }>("/api/skills").then((r) => r.skills || []),
  toggleSkill: (id: string, enabled: boolean) =>
    request<{ ok: boolean }>("/api/skills/toggle", { method: "POST", ...jsonBody({ id, enabled }) }),
  skillDoc: (id: string) => request<{ id: string; content: string }>(`/api/skills/doc?id=${encodeURIComponent(id)}`),
};

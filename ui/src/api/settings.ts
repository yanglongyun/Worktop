import { request, jsonBody } from "../lib/http";

export type Settings = {
  apiUrl: string;
  apiKey: string;
  model: string;
  system: string;
  compressThreshold?: string;
  compactPrompt?: string;
  toolResultMaxChars?: string;
  /** 匿名使用统计:on/off(只收 事件名/版本/平台/匿名安装 id)。 */
  telemetry?: string;
  /** 规则开关:on / off。 */
  rulesEnabled?: string;
};

export type Rule = {
  id: string;
  text: string;
  enabled: boolean;
  position: number;
};

export const settingsApi = {
  getSettings: () => request<{ settings: Settings }>("/api/settings"),
  saveSettings: (s: Partial<Settings>) =>
    request<{ settings: Settings }>("/api/settings", { method: "POST", ...jsonBody(s) }).then((result) => {
      window.dispatchEvent(new Event("worktop:settings-saved"));
      return result;
    }),
  listRules: () => request<{ rules: Rule[] }>("/api/settings/rules").then((r) => r.rules),
  createRule: (text: string) =>
    request<{ rule: Rule }>("/api/settings/rules", { method: "POST", ...jsonBody({ text }) }),
  updateRule: (id: string, patch: { text?: string; enabled?: boolean }) =>
    request<{ rule: Rule }>(`/api/settings/rules?id=${encodeURIComponent(id)}`, { method: "PATCH", ...jsonBody(patch) }),
  deleteRule: (id: string) => request(`/api/settings/rules?id=${encodeURIComponent(id)}`, { method: "DELETE" }),
  reorderRules: (ids: string[]) =>
    request<{ rules: Rule[] }>("/api/settings/rules/order", { method: "POST", ...jsonBody({ ids }) }).then((r) => r.rules),
};

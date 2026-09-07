// 规则 + 提醒卡。
//
// 规则只有一个出口:写进提示词。没有硬闸、没有编译。
// 提醒卡是助手自己觉得该问一句时停下来等你表态;出口两个:不允许 / 允许(这一次)。

export type ApprovalCard = {
  id: string;
  chatId: string;
  summary: string;
  detail: string;
  risk: string;
  at: string;
};

export type Rule = {
  id: string;
  text: string;
  enabled: boolean;
  position: number;
};

import { request, jsonBody } from "./http";

export const permissionApi = {
  listRules: () => request<{ rules: Rule[] }>("/api/rules").then((r) => r.rules),
  createRule: (text: string) =>
    request<{ rule: Rule }>("/api/rules", { method: "POST", ...jsonBody({ text }) }),
  updateRule: (id: string, patch: { text?: string; enabled?: boolean }) =>
    request<{ rule: Rule }>(`/api/rules?id=${encodeURIComponent(id)}`, { method: "PATCH", ...jsonBody(patch) }),
  deleteRule: (id: string) => request(`/api/rules?id=${encodeURIComponent(id)}`, { method: "DELETE" }),
  /** 整份顺序发过去 —— 拖完就是一次落库,不做增量位移。 */
  reorderRules: (ids: string[]) =>
    request<{ rules: Rule[] }>("/api/rules/order", { method: "POST", ...jsonBody({ ids }) }).then((r) => r.rules),
  listApprovals: (chatId: string) =>
    request<{ approvals: ApprovalCard[] }>(`/api/approvals?chatId=${encodeURIComponent(chatId)}`).then((r) => r.approvals),
  respond: (id: string, answer: "allow" | "deny") =>
    request("/api/approvals", { method: "POST", ...jsonBody({ id, answer }) }),
};

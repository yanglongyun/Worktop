import { request, jsonBody } from "../lib/http";
import type { Attachment } from "./files";

export type Chat = {
  id: string;
  kind: "chat";
  title: string;
  system: string | null;
  pinned: boolean;
  last_read_at: string | null;
  created_at: string;
  updated_at: string;
  last?: { role: "user" | "assistant"; text: string; at: string } | null;
  status?: "idle" | "running" | "done" | "error" | "cancelled";
  unread?: boolean;
};

export type MessageRow = {
  id: number;
  item: StoredItem;
  meta: Record<string, any> | null;
  usage: Record<string, any> | null;
  created_at: string;
};

export type StoredItem = {
  type?: string;
  role?: string;
  content?: string | Array<{ type?: string; text?: string }> | null;
  summary?: Array<{ text?: string }>;
  call_id?: string;
  name?: string;
  arguments?: string;
  output?: string;
  attachments?: Attachment[];
};

export type ApprovalCard = {
  id: string;
  chatId: string;
  summary: string;
  detail: string;
  risk: string;
  at: string;
};

export const chatsApi = {
  listChats: () => request<{ chats: Chat[] }>("/api/chats"),
  getChat: (id: string) =>
    request<{ item: Chat }>(`/api/chats/get?id=${encodeURIComponent(id)}`),
  createChat: (opts: { title: string; system?: string }) =>
    request<{ item: Chat }>("/api/chats", { method: "POST", ...jsonBody(opts) }),
  updateChat: (id: string, patch: { title?: string; system?: string; pinned?: boolean }) =>
    request<{ item: Chat }>(`/api/chats?id=${encodeURIComponent(id)}`, { method: "PATCH", ...jsonBody(patch) }),
  deleteChat: (id: string) =>
    request<{ ok: boolean }>(`/api/chats?id=${encodeURIComponent(id)}`, { method: "DELETE" }),
  markRead: (id: string) =>
    request<{ item: Chat }>(`/api/chats/read?id=${encodeURIComponent(id)}`, { method: "POST" }),
  listMessages: (chatId: string) =>
    request<{ rows: MessageRow[] }>(`/api/chats/messages?chatId=${encodeURIComponent(chatId)}`),
  listRuns: () => request<{ ids: string[] }>("/api/chats/runs"),
  listApprovals: (chatId: string) =>
    request<{ approvals: ApprovalCard[] }>(`/api/chats/approvals?chatId=${encodeURIComponent(chatId)}`).then((r) => r.approvals),
  respondApproval: (id: string, answer: "allow" | "deny") =>
    request("/api/chats/approvals", { method: "POST", ...jsonBody({ id, answer }) }),
};

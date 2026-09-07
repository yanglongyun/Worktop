import { request, jsonBody } from "../lib/http";

export type AppInfo = {
  id: string;
  name: string;
  version: string;
  description: string;
  permissions: string[];
  hasIcon: boolean;
  hasDoc: boolean;
  mode: "on-demand" | "always" | "static";
  invalid: string;
  status: "stopped" | "starting" | "ready" | "failed" | "invalid";
  error: string;
  port: number;
};

export type TaskInfo = {
  /** 同时也是这段任务会话的 chatId —— 过程在 messages 里。 */
  id: string;
  app_id: string;
  title: string;
  prompt: string;
  status: "running" | "done" | "error" | "aborted";
  error: string | null;
  created_at: string;
  updated_at: string;
};

export const appsApi = {
  listTasks: (limit = 50) => request<{ tasks: TaskInfo[] }>(`/api/apps/tasks?limit=${limit}`).then((r) => r.tasks || []),
  listApps: () => request<{ apps: AppInfo[] }>("/api/apps").then((r) => r.apps || []),
  appAddress: (id: string) =>
    request<{ origin: string }>(`/api/apps/address?id=${encodeURIComponent(id)}`).then((r) => r.origin),
  stopApp: (id: string) =>
    request<{ ok: boolean }>("/api/apps/stop", { method: "POST", ...jsonBody({ id }) }),
  restartApp: (id: string) =>
    request<{ ok: boolean }>("/api/apps/restart", { method: "POST", ...jsonBody({ id }) }),
};

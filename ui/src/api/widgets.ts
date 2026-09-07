import { request, jsonBody } from "../lib/http";

export type WidgetInfo = {
  id: string;
  name: string;
  icon: string;
  description: string;
  permissions: string[];
};

export const widgetsApi = {
  listWidgets: () => request<{ widgets: WidgetInfo[] }>("/api/widgets").then((r) => r.widgets || []),
  widgetUrl: (id: string) =>
    request<{ url: string }>(`/api/widgets/url?id=${encodeURIComponent(id)}`).then((r) => r.url),
  widgetConfirmResult: (requestId: string, ok: boolean) =>
    request<{ ok: boolean }>("/api/widgets/confirm/result", { method: "POST", ...jsonBody({ requestId, ok }) }),
  removeWidget: (id: string) =>
    request<{ ok: boolean; trashed: string }>("/api/widgets/remove", { method: "POST", ...jsonBody({ id }) }),
};

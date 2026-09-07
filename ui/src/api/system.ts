import { request } from "../lib/http";

export const systemApi = {
  pickDirectory: () => request<{ path: string | null }>("/api/system/directory/pick", { method: "POST" }),
  revealNode: (id: string) =>
    request<{ ok: boolean; path: string }>(`/api/system/reveal?id=${encodeURIComponent(id)}`, { method: "POST" }),
};

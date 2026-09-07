import { request, jsonBody } from "../lib/http";

export type Bookmark = {
  id: string;
  title: string;
  url: string;
  kind: "site" | "folder";
  parent_id: string | null;
  position: number;
  created_at: string;
};

export type HistoryEntry = { url: string; title: string; visits: number; visited_at: string };

export type PasswordEntry = { id: string; host: string; url: string; username: string; note: string; created_at: string; updated_at: string };

export const browserApi = {
  listPasswords: () => request<{ passwords: PasswordEntry[] }>("/api/browser/passwords").then((r) => r.passwords || []),
  revealPassword: (id: string) => request<{ password: string }>(`/api/browser/passwords/reveal?id=${encodeURIComponent(id)}`).then((r) => r.password),
  createPassword: (body: { url?: string; username?: string; password?: string; note?: string }) =>
    request<{ item: PasswordEntry }>("/api/browser/passwords", { method: "POST", ...jsonBody(body) }).then((r) => r.item),
  updatePassword: (id: string, body: { url?: string; username?: string; password?: string; note?: string }) =>
    request<{ item: PasswordEntry }>(`/api/browser/passwords?id=${encodeURIComponent(id)}`, { method: "PATCH", ...jsonBody(body) }).then((r) => r.item),
  removePassword: (id: string) => request<{ deleted: boolean }>(`/api/browser/passwords?id=${encodeURIComponent(id)}`, { method: "DELETE" }),
  clearPasswords: () => request<{ cleared: boolean }>("/api/browser/passwords?all=1", { method: "DELETE" }),
  importPasswords: (items: { url?: string; username?: string; password?: string; note?: string }[]) =>
    request<{ added: number }>("/api/browser/passwords/import", { method: "POST", ...jsonBody({ items }) }).then((r) => r.added),
  exportPasswordsCsv: () => fetch("/api/browser/passwords/export").then((r) => r.text()),
  listBookmarks: () => request<{ bookmarks: Bookmark[] }>("/api/browser/bookmarks").then((r) => r.bookmarks || []),
  createBookmarkFolder: (body: { title?: string; parentId?: string | null }) =>
    request<{ item: Bookmark }>("/api/browser/bookmarks/folder", { method: "POST", ...jsonBody(body) }).then((r) => r.item),
  reorderBookmarks: (body: { parentId: string | null; ids: string[] }) =>
    request<{ bookmarks: Bookmark[] }>("/api/browser/bookmarks/order", { method: "POST", ...jsonBody(body) }).then((r) => r.bookmarks || []),
  listHistory: (q = "") =>
    request<{ history: HistoryEntry[] }>(`/api/browser/history${q ? `?q=${encodeURIComponent(q)}` : ""}`)
      .then((r) => r.history || []),
  noteVisit: (body: { url: string; title?: string }) =>
    request<{ noted: boolean }>("/api/browser/history/visit", { method: "POST", ...jsonBody(body) }).catch(() => null),
  forgetHistory: (target: { url?: string; all?: boolean }) =>
    request<{ forgot: boolean }>(
      `/api/browser/history?${target.all ? "all=1" : `url=${encodeURIComponent(target.url || "")}`}`,
      { method: "DELETE" },
    ),
  createBookmark: (body: { title?: string; url: string; parentId?: string | null }) =>
    request<{ item: Bookmark }>("/api/browser/bookmarks", { method: "POST", ...jsonBody(body) }).then((r) => r.item),
  updateBookmark: (id: string, body: { title?: string; url?: string }) =>
    request<{ item: Bookmark }>(`/api/browser/bookmarks?id=${encodeURIComponent(id)}`, { method: "PATCH", ...jsonBody(body) }).then((r) => r.item),
  removeBookmark: (id: string) =>
    request<{ deleted: boolean }>(`/api/browser/bookmarks?id=${encodeURIComponent(id)}`, { method: "DELETE" }),
};

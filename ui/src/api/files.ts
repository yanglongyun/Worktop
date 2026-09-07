import { request, jsonBody } from "../lib/http";

export type FileNode = {
  id: string;
  parent_id: string | null;
  kind: "folder" | "file";
  title: string;
  created_at: string | null;
  content?: string | null;
  size?: number;
  binary?: boolean;
  tooLarge?: boolean;
  isRoot?: boolean;
};

export type Attachment = { id: string; name: string; path: string; mimeType: string; size: number; url: string };

export const filesApi = {
  listRoots: () => request<{ items: FileNode[] }>("/api/files/tree?parentId="),
  listChildren: (parentId: string) =>
    request<{ items: FileNode[] }>(`/api/files/tree?parentId=${encodeURIComponent(parentId)}`),
  listAllNodes: () => request<{ items: FileNode[] }>("/api/files/tree/all"),
  getNode: (id: string) =>
    request<{ item: FileNode }>(`/api/files/tree/get?id=${encodeURIComponent(id)}`),
  createNode: (opts: { kind: "folder" | "file"; title: string; parentId?: string; content?: string }) =>
    request<{ item: FileNode }>("/api/files/tree", { method: "POST", ...jsonBody(opts) }),
  updateNode: (id: string, patch: { title?: string; content?: string; parentId?: string | null; overwrite?: boolean }) =>
    request<{ item: FileNode }>(`/api/files/tree?id=${encodeURIComponent(id)}`, { method: "PATCH", ...jsonBody(patch) }),
  moveNode: (id: string, newParentId: string | null, overwrite?: boolean) =>
    request<{ item: FileNode }>(`/api/files/tree?id=${encodeURIComponent(id)}`, { method: "PATCH", ...jsonBody({ parentId: newParentId, overwrite }) }),
  copyNode: (id: string, parentId?: string | null) =>
    request<{ item: FileNode }>("/api/files/tree/copy", { method: "POST", ...jsonBody({ id, parentId }) }),
  importFile: (opts: { parentId?: string | null; relPath: string; dataBase64: string }) =>
    request<{ item: FileNode }>("/api/files/tree/import", { method: "POST", ...jsonBody(opts) }),
  deleteNode: (id: string) =>
    request<{ ok: boolean }>(`/api/files/tree?id=${encodeURIComponent(id)}`, { method: "DELETE" }),
  uploadFile: (opts: { name: string; mimeType: string; dataBase64: string }) =>
    request<{ attachment: Attachment }>("/api/files/upload", { method: "POST", ...jsonBody(opts) }),
  addRoot: (opts: { path: string; title?: string }) =>
    request<{ item: FileNode }>("/api/files/roots", { method: "POST", ...jsonBody(opts) }),
  removeRoot: (id: string) =>
    request<{ ok: boolean }>(`/api/files/roots?id=${encodeURIComponent(id)}`, { method: "DELETE" }),
};

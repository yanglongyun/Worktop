import { request, jsonBody } from "../lib/http";

export type GitCommitInfo = { hash: string; short: string; author: string; date: string; subject: string };

export type GitCommitFile = { status: string; path: string; oldPath: string | null };

export type GitFileStatus = {
  path: string;
  absPath: string;
  originalPath: string | null;
  index: string;
  worktree: string;
  status: "untracked" | "staged+modified" | "staged" | "modified" | "changed" | "conflict";
  renamed: boolean;
  staged: boolean;
  unstaged: boolean;
};

export type GitRepositoryStatus = {
  fileRootId: string;
  fileRootTitle: string;
  fileRootPath: string;
  root: string | null;
  isRepo: boolean;
  branch: string | null;
  upstream: string | null;
  ahead: number;
  behind: number;
  files: GitFileStatus[];
};

export type GitBranches = {
  current: string;
  branches: string[];
};

export const gitApi = {
  gitStatus: () => request<{ repositories: GitRepositoryStatus[] }>("/api/git/status"),
  gitRepository: (path: string) =>
    request<{ repository: GitRepositoryStatus | null }>(`/api/git/repository?path=${encodeURIComponent(path)}`),
  gitDiff: (opts: { root: string; path: string; staged?: boolean; commit?: string }) =>
    request<{ before: string; after: string; binary: boolean }>(`/api/git/diff?root=${encodeURIComponent(opts.root)}&path=${encodeURIComponent(opts.path)}${opts.staged ? "&staged=1" : ""}${opts.commit ? `&commit=${encodeURIComponent(opts.commit)}` : ""}`),
  gitLog: (root: string, limit = 50) =>
    request<{ commits: GitCommitInfo[] }>(`/api/git/log?root=${encodeURIComponent(root)}&limit=${limit}`),
  gitShow: (root: string, hash: string) =>
    request<{ files: GitCommitFile[] }>(`/api/git/show?root=${encodeURIComponent(root)}&hash=${encodeURIComponent(hash)}`),
  gitBranches: (root: string) =>
    request<GitBranches>(`/api/git/branches?root=${encodeURIComponent(root)}`),
  gitStage: (opts: { root: string; path?: string; all?: boolean }) =>
    request<{ repository: GitRepositoryStatus }>("/api/git/stage", { method: "POST", ...jsonBody(opts) }),
  gitUnstage: (opts: { root: string; path?: string; all?: boolean }) =>
    request<{ repository: GitRepositoryStatus }>("/api/git/unstage", { method: "POST", ...jsonBody(opts) }),
  gitDiscard: (opts: { root: string; path: string }) =>
    request<{ repository: GitRepositoryStatus }>("/api/git/discard", { method: "POST", ...jsonBody(opts) }),
  gitCommit: (opts: { root: string; message: string }) =>
    request<{ output: string; repository: GitRepositoryStatus }>("/api/git/commit", { method: "POST", ...jsonBody(opts) }),
  gitRemote: (opts: { root: string; action: "fetch" | "pull" | "push" }) =>
    request<{ output: string; repository: GitRepositoryStatus }>("/api/git/remote", { method: "POST", ...jsonBody(opts) }),
  gitCheckout: (opts: { root: string; branch: string }) =>
    request<{ output: string; repository: GitRepositoryStatus; branches: GitBranches }>("/api/git/checkout", { method: "POST", ...jsonBody(opts) }),
};

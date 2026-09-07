import { request, jsonBody } from "./lib/http";

// 统一的一个 item:kind 区分它是空间 / 对话 / 文件。
// 文件夹和文件在文件树上;对话独立保存在 SQLite。
export type Node = {
  id: string;
  parent_id: string | null;                                      // 所在空间(根 = null;agent 恒为 null)
  kind: "space" | "chat" | "file";
  title: string;
  system: string | null;                                         // 仅 agent:人格
  content: string | null;                                        // 仅 file:内容
  last_read_at: string | null;                                   // 仅 agent
  created_at: string;
  updated_at?: string;                                           // 仅 agent:最后活动时间
  /** 仅 agent:最后一句人话(跳过思考/工具),会话列表的预览行用。 */
  last?: { role: "user" | "assistant"; text: string; at: string } | null;
  pinned?: boolean;                                              // 仅 agent:置顶
  status?: "idle" | "running" | "done" | "error" | "cancelled";  // 仅 agent(界面按运行事件维护)
  unread?: boolean;                                              // 仅 agent
  size?: number;                                                 // 仅 file:字节数
  binary?: boolean;                                              // 仅 file:二进制,无法当文本预览
  tooLarge?: boolean;                                            // 仅 file:超过文本预览上限
  workspace?: boolean;                                           // node 且 parent_id=null 时表示工作区 root
};

/** 侧栏「网站」页收藏的链接。 */
/** 应用:manifest 的事实 + 运行时状态。 */
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

/** 网站收藏:一棵浅树。kind='folder' 的没有 url,别的行 parent_id 指向它。 */
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

export type GitCommitInfo = { hash: string; short: string; author: string; date: string; subject: string };
export type GitCommitFile = { status: string; path: string; oldPath: string | null };

export type Site = {
  id: string;
  title: string;
  url: string;
  kind: "site" | "folder";
  parent_id: string | null;
  position: number;
  created_at: string;
};

/** 密码:列表不带密码,明文单独 reveal。 */
export type PasswordEntry = { id: string; host: string; url: string; username: string; note: string; created_at: string; updated_at: string };

/** 浏览记录:一个 url 一行,重复访问只抬时间与次数。 */
export type HistoryEntry = { url: string; title: string; visits: number; visited_at: string };

/** 技能:~/.worktop/skills/<id>/SKILL.md;enabled=false 不进提示词。 */
export type SkillInfo = { id: string; name: string; description: string; path: string; enabled: boolean };

/** 组件:目录即安装,manifest = 权限清单(契约见出厂技能 skills/widget)。 */
export type WidgetInfo = {
  id: string;
  name: string;
  icon: string;
  description: string;
  permissions: string[];
};

/** 消息附件(图片/文件):内容寻址存储,消息里只存元数据。 */
export type Attachment = { id: string; name: string; path: string; mimeType: string; size: number; url: string };

/** 落库的 Responses item(body 解析后):user/system 消息、reasoning、message、function_call、function_call_output。 */
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

/** 邮箱里的一行:一行一个 item。 */
export type MessageRow = {
  id: number;
  item: StoredItem;
  meta: Record<string, any> | null;
  usage: Record<string, any> | null;
  created_at: string;
};


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
  workspaceId: string;
  workspaceTitle: string;
  workspacePath: string;
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

export const api = {

  listRoots: () => request<{ items: Node[] }>("/api/tree?parentId="),
  listChildren: (parentId: string) =>
    request<{ items: Node[] }>(`/api/tree?parentId=${encodeURIComponent(parentId)}`),
  listAllNodes: () => request<{ items: Node[] }>("/api/tree/all"),
  getNode: (id: string) =>
    request<{ item: Node }>(`/api/tree/get?id=${encodeURIComponent(id)}`),
  createNode: (opts: { kind: "space" | "file"; title: string; parentId?: string; content?: string }) =>
    request<{ item: Node }>("/api/tree", { method: "POST", ...jsonBody(opts) }),
  updateNode: (id: string, patch: { title?: string; content?: string; parentId?: string | null; overwrite?: boolean }) =>
    request<{ item: Node }>(`/api/tree?id=${encodeURIComponent(id)}`, { method: "PATCH", ...jsonBody(patch) }),
  moveNode: (id: string, newParentId: string | null, overwrite?: boolean) =>
    request<{ item: Node }>(`/api/tree?id=${encodeURIComponent(id)}`, { method: "PATCH", ...jsonBody({ parentId: newParentId, overwrite }) }),
  copyNode: (id: string, parentId?: string | null) =>
    request<{ item: Node }>("/api/tree/copy", { method: "POST", ...jsonBody({ id, parentId }) }),
  importFile: (opts: { parentId?: string | null; relPath: string; dataBase64: string }) =>
    request<{ item: Node }>("/api/tree/import", { method: "POST", ...jsonBody(opts) }),
  deleteNode: (id: string) =>
    request<{ ok: boolean }>(`/api/tree?id=${encodeURIComponent(id)}`, { method: "DELETE" }),

  // ── 对话(会话列表)──
  listChats: () => request<{ chats: Node[] }>("/api/chats"),
  getChat: (id: string) =>
    request<{ item: Node }>(`/api/chats/get?id=${encodeURIComponent(id)}`),
  createChat: (opts: { title: string; system?: string }) =>
    request<{ item: Node }>("/api/chats", { method: "POST", ...jsonBody(opts) }),
  updateChat: (id: string, patch: { title?: string; system?: string; pinned?: boolean }) =>
    request<{ item: Node }>(`/api/chats?id=${encodeURIComponent(id)}`, { method: "PATCH", ...jsonBody(patch) }),
  deleteChat: (id: string) =>
    request<{ ok: boolean }>(`/api/chats?id=${encodeURIComponent(id)}`, { method: "DELETE" }),
  markAgentRead: (id: string) =>
    request<{ item: Node }>(`/api/chats/read?id=${encodeURIComponent(id)}`, { method: "POST" }),

  // ── 附件上传 ──
  uploadFile: (opts: { name: string; mimeType: string; dataBase64: string }) =>
    request<{ attachment: Attachment }>("/api/upload", { method: "POST", ...jsonBody(opts) }),
  // ── 组件(widgets):目录即安装,每组件一个 origin ──
  listWidgets: () => request<{ widgets: WidgetInfo[] }>("/api/widgets").then((r) => r.widgets || []),
  /** 组件的地址:http://127.0.0.1:<组件专属端口>/ —— 真 origin,不是路径前缀。 */
  widgetUrl: (id: string) =>
    request<{ url: string }>(`/api/widgets/url?id=${encodeURIComponent(id)}`).then((r) => r.url),
  /** 任务:应用触发的 agent 轮次。 */
  listTasks: (limit = 50) => request<{ tasks: TaskInfo[] }>(`/api/tasks?limit=${limit}`).then((r) => r.tasks || []),
  /** 组件 confirm 的回执。 */
  widgetConfirmResult: (requestId: string, ok: boolean) =>
    request<{ ok: boolean }>("/api/widgets/confirm-result", { method: "POST", ...jsonBody({ requestId, ok }) }),
  /** 卸载 = 挪进回收站(保留 30 天)。 */
  removeWidget: (id: string) =>
    request<{ ok: boolean; trashed: string }>("/api/widgets/remove", { method: "POST", ...jsonBody({ id }) }),

  // ── 技能(产品家目录 ~/.worktop/skills,出厂的 + 用户放的)──
  listSkills: () => request<{ skills: SkillInfo[] }>("/api/skills").then((r) => r.skills || []),
  toggleSkill: (id: string, enabled: boolean) =>
    request<{ ok: boolean }>("/api/skills/toggle", { method: "POST", ...jsonBody({ id, enabled }) }),
  skillDoc: (id: string) => request<{ id: string; content: string }>(`/api/skills/doc?id=${encodeURIComponent(id)}`),

  // ── 密码(宿主加密落库)──
  listPasswords: () => request<{ passwords: PasswordEntry[] }>("/api/passwords").then((r) => r.passwords || []),
  revealPassword: (id: string) => request<{ password: string }>(`/api/passwords/reveal?id=${encodeURIComponent(id)}`).then((r) => r.password),
  createPassword: (body: { url?: string; username?: string; password?: string; note?: string }) =>
    request<{ item: PasswordEntry }>("/api/passwords", { method: "POST", ...jsonBody(body) }).then((r) => r.item),
  updatePassword: (id: string, body: { url?: string; username?: string; password?: string; note?: string }) =>
    request<{ item: PasswordEntry }>(`/api/passwords?id=${encodeURIComponent(id)}`, { method: "PATCH", ...jsonBody(body) }).then((r) => r.item),
  removePassword: (id: string) => request<{ deleted: boolean }>(`/api/passwords?id=${encodeURIComponent(id)}`, { method: "DELETE" }),
  clearPasswords: () => request<{ cleared: boolean }>("/api/passwords?all=1", { method: "DELETE" }),
  importPasswords: (items: { url?: string; username?: string; password?: string; note?: string }[]) =>
    request<{ added: number }>("/api/passwords/import", { method: "POST", ...jsonBody({ items }) }).then((r) => r.added),
  exportPasswordsCsv: () => fetch("/api/passwords/export").then((r) => r.text()),

  // ── 应用(apps:跨宿主的公共契约,见仓库根 APP.md)──
  listApps: () => request<{ apps: AppInfo[] }>("/api/apps").then((r) => r.apps || []),
  /** 取址即保活:没起的会被顺手拉起。**每次现取,不要缓存端口。** */
  appAddress: (id: string) =>
    request<{ origin: string }>(`/api/apps/address?id=${encodeURIComponent(id)}`).then((r) => r.origin),
  stopApp: (id: string) =>
    request<{ ok: boolean }>("/api/apps/stop", { method: "POST", ...jsonBody({ id }) }),
  restartApp: (id: string) =>
    request<{ ok: boolean }>("/api/apps/restart", { method: "POST", ...jsonBody({ id }) }),

  // ── 网站收藏(原生「网站」面板)──
  listSites: () => request<{ sites: Site[] }>("/api/sites").then((r) => r.sites || []),
  createSiteFolder: (body: { title?: string; parentId?: string | null }) =>
    request<{ item: Site }>("/api/sites/folder", { method: "POST", ...jsonBody(body) }).then((r) => r.item),
  /** 拖拽后把某一层的完整顺序发过去 —— 顺序与归属一起改。 */
  reorderSites: (body: { parentId: string | null; ids: string[] }) =>
    request<{ sites: Site[] }>("/api/sites/order", { method: "POST", ...jsonBody(body) }).then((r) => r.sites || []),

  // ── 浏览记录 ──
  listHistory: (q = "") =>
    request<{ history: HistoryEntry[] }>(`/api/history${q ? `?q=${encodeURIComponent(q)}` : ""}`)
      .then((r) => r.history || []),
  noteVisit: (body: { url: string; title?: string }) =>
    request<{ noted: boolean }>("/api/history/visit", { method: "POST", ...jsonBody(body) }).catch(() => null),
  forgetHistory: (target: { url?: string; all?: boolean }) =>
    request<{ forgot: boolean }>(
      `/api/history?${target.all ? "all=1" : `url=${encodeURIComponent(target.url || "")}`}`,
      { method: "DELETE" },
    ),

  createSite: (body: { title?: string; url: string; parentId?: string | null }) =>
    request<{ item: Site }>("/api/sites", { method: "POST", ...jsonBody(body) }).then((r) => r.item),
  updateSite: (id: string, body: { title?: string; url?: string }) =>
    request<{ item: Site }>(`/api/sites?id=${encodeURIComponent(id)}`, { method: "PATCH", ...jsonBody(body) }).then((r) => r.item),
  removeSite: (id: string) =>
    request<{ deleted: boolean }>(`/api/sites?id=${encodeURIComponent(id)}`, { method: "DELETE" }),
  pickWorkspaceDirectory: () => request<{ path: string | null }>("/api/workspaces/pick", { method: "POST" }),
  addWorkspace: (opts: { path: string; title?: string }) =>
    request<{ item: Node }>("/api/workspaces", { method: "POST", ...jsonBody(opts) }),
  removeWorkspace: (id: string) =>
    request<{ ok: boolean }>(`/api/workspaces?id=${encodeURIComponent(id)}`, { method: "DELETE" }),

  listMessages: (chatId: string) =>
    request<{ rows: MessageRow[] }>(`/api/messages?chatId=${encodeURIComponent(chatId)}`),

  listRuns: () => request<{ ids: string[] }>("/api/runs"),

  gitStatus: () => request<{ repositories: GitRepositoryStatus[] }>("/api/git/status"),
  gitRepository: (path: string) =>
    request<{ repository: GitRepositoryStatus | null }>(`/api/git/repository?path=${encodeURIComponent(path)}`),
  /** merge 视图用的两份完整内容(unstaged = 暂存区 vs 工作树;staged = HEAD vs 暂存区)。 */
  gitFilePair: (opts: { root: string; path: string; staged?: boolean; commit?: string }) =>
    request<{ before: string; after: string; binary: boolean }>(`/api/git/file-pair?root=${encodeURIComponent(opts.root)}&path=${encodeURIComponent(opts.path)}${opts.staged ? "&staged=1" : ""}${opts.commit ? `&commit=${encodeURIComponent(opts.commit)}` : ""}`),
  /** 提交历史与单次提交的文件清单。 */
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

  getSettings: () => request<{ settings: Settings }>("/api/settings"),
  saveSettings: (s: Partial<Settings>) =>
    request<{ settings: Settings }>("/api/settings", { method: "POST", ...jsonBody(s) }).then((result) => {
      window.dispatchEvent(new Event("worktop:settings-saved"));
      return result;
    }),


  // 在系统文件管理器(Finder / 资源管理器)里显示该节点
  revealNode: (id: string) =>
    request<{ ok: boolean; path: string }>(`/api/reveal?id=${encodeURIComponent(id)}`, { method: "POST" }),
};

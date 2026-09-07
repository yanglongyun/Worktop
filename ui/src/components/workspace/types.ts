import type { Node, SkillInfo } from "../../api";

const TERMINAL_TAB_PREFIX = "__terminal__";
const GIT_TAB_PREFIX = "__git__";
const GIT_DIFF_TAB_PREFIX = "__git_diff__";
const SETTINGS_TAB_ID = "__settings__";
const WIDGETS_TAB_ID = "__widgets__";

export type TerminalTab = {
  id: string;
  kind: "terminal";
  title: string;
  cwd: string;
  initialCommand?: string;
};

export type GitDiffTab = {
  id: string;
  kind: "git-diff";
  title: string;
  root: string;
  path: string;
  staged?: boolean;
  /** 看历史:该提交 vs 其父提交(与 staged 互斥)。 */
  commit?: string;
};

export type GitTab = {
  id: string;
  kind: "git";
  title: string;
  root: string;
};

export type SettingsTab = {
  id: typeof SETTINGS_TAB_ID;
  kind: "settings";
  title: "设置";
};

/** 组件管理:装了哪些、钉/取下、删除、让 AI 造一个。
 *  走标签页而不是侧栏面板 —— 管理是「摊开来看」的事,侧栏那 260px 摆不下。 */
export type WidgetsTab = {
  id: typeof WIDGETS_TAB_ID;
  kind: "widgets";
  title: "组件";
};

const TASK_TAB_PREFIX = "__task__";
const APP_TAB_PREFIX = "__app__";

/** 应用标签:一个 iframe 指向 app 自己的 origin(每个 app 一个真端口)。
 *  地址不存在这里 —— 端口每次启动都变,打开时现向宿主取。 */
export type AppTab = {
  id: string;
  kind: "app";
  title: string;
  appId: string;
};

const LAUNCHER_TAB_PREFIX = "__launcher__";

/** 仅在界面存在的起始页,首条消息发送时才成为数据库里的对话。 */
export type ChatStartTab = {
  id: string;
  kind: "chat-start";
  title: string;
  initialPrompt?: string;
  sendOnOpen?: boolean;
};

export const chatStartTab = (initialPrompt?: string, sendOnOpen = false): ChatStartTab => ({
  id: `__chat_start__:${crypto.randomUUID()}`,
  kind: "chat-start",
  title: "新对话",
  initialPrompt,
  sendOnOpen,
});

/** 新标签页:一个全能输入框 —— 输入文字开对话,输入网址开网站;就地转身成目标标签。 */
export type LauncherTab = {
  id: string;
  kind: "launcher";
  title: string;
};

const WEB_TAB_PREFIX = "__web__";

/** 网页标签:Electron 壳里的 <webview>,常驻挂载(卸载 = 断网重载,登录态全丢)。 */
export type WebTab = {
  id: string;
  kind: "web";
  title: string;
  url: string;
  /** browser open 的关联令牌:webview 注册时带上,server 以此兑现「打开标签」请求。 */
  token?: string;
  /** 页面上报的真实 favicon 地址(page-favicon-updated),标签栏优先用它。 */
  favicon?: string;
  /**
   * 从哪个标签点出来的。**Chrome 的规则**:从某个标签打开的新标签插在它后面
   * (以及它已经开出来的那些之后),不是丢到末尾 —— 丢到末尾会让你点开一个链接
   * 之后得横跨整条标签栏去找它。加号/⌘T 开的没有来源,才排末尾。
   */
  openerId?: string;
};

/** 任务详情:应用触发的一次 agent 轮次,摊开看 prompt / 回复 / 报错。 */
export type TaskTab = {
  id: string;
  kind: "task";
  title: string;
  taskId: string;
};

export type SkillTab = { id: string; kind: "skill"; title: string; skill: SkillInfo };

export const skillTab = (skill: SkillInfo): SkillTab => ({
  id: `__skill__:${skill.id}`, kind: "skill", title: `${skill.name} · SKILL.md`, skill,
});

export type WorkspaceTab = Node | ChatStartTab | TerminalTab | GitTab | GitDiffTab | SettingsTab | WidgetsTab | AppTab | WebTab | LauncherTab | TaskTab | SkillTab;
export type WorkspaceGroupId = "main" | "side";

export type WorkspaceGroupState = {
  id: WorkspaceGroupId;
  tabs: WorkspaceTab[];
  activeId: string | null;
  previewId: string | null;
};

/** 标签操作合集:App 装一次包,贯穿 Layout → Group → TabBar,不再逐层点名 20 个回调。 */
export type TabActions = {
  focusGroup: (groupId: WorkspaceGroupId) => void;
  activate: (groupId: WorkspaceGroupId, id: string) => void;
  close: (groupId: WorkspaceGroupId, id: string) => void;
  reorder: (groupId: WorkspaceGroupId, tabs: WorkspaceTab[]) => void;
  moveFromGroup: (fromGroupId: WorkspaceGroupId, tabId: string, toGroupId: WorkspaceGroupId, toIndex?: number) => void;
  moveToOther: (groupId: WorkspaceGroupId, tabId: string) => void;
  toggleSideGroup: () => void;
  closeOthers: (groupId: WorkspaceGroupId, keepId: string) => void;
  closeToRight: (groupId: WorkspaceGroupId, afterId: string) => void;
  closeGroup: (groupId: WorkspaceGroupId) => void;
  newTab: (groupId: WorkspaceGroupId, anchor?: HTMLElement) => void;
};

export const terminalTab = (cwd: string, title = "Terminal", initialCommand?: string): TerminalTab => ({
  id: `${TERMINAL_TAB_PREFIX}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`,
  kind: "terminal",
  title,
  cwd,
  initialCommand,
});

export const gitTab = (root: string, title = "Git"): GitTab => ({
  id: `${GIT_TAB_PREFIX}:${root}`,
  kind: "git",
  title,
  root,
});

export const gitDiffTab = (root: string, filePath: string, staged = false, commit = ""): GitDiffTab => ({
  id: `${GIT_DIFF_TAB_PREFIX}:${root}:${filePath}:${commit || (staged ? "staged" : "worktree")}`,
  kind: "git-diff",
  title: commit ? `${filePath} @ ${commit.slice(0, 7)}` : `${filePath}${staged ? " (staged)" : ""}`,
  root,
  path: filePath,
  staged,
  commit: commit || undefined,
});

export const settingsTab = (): SettingsTab => ({
  id: SETTINGS_TAB_ID,
  kind: "settings",
  title: "设置",
});

export const taskTab = (taskId: string, title: string): TaskTab => ({
  id: `${TASK_TAB_PREFIX}:${taskId}`,
  kind: "task",
  title,
  taskId,
});

export const widgetsTab = (): WidgetsTab => ({
  id: WIDGETS_TAB_ID,
  kind: "widgets",
  title: "组件",
});

/** 同一个应用只开一个标签:id 由 appId 定,重复打开会聚焦到已有那个。 */
export const appTab = (appId: string, title: string): AppTab => ({
  id: `${APP_TAB_PREFIX}:${appId}`,
  kind: "app",
  title,
  appId,
});

export const launcherTab = (): LauncherTab => ({
  id: `${LAUNCHER_TAB_PREFIX}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`,
  kind: "launcher",
  title: "新标签页",
});

export const webTab = (url: string, title?: string, token?: string, openerId?: string): WebTab => ({
  id: `${WEB_TAB_PREFIX}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`,
  kind: "web",
  title: title || url.replace(/^https?:\/\//, "").replace(/\/$/, ""),
  url,
  token,
  openerId,
});

export const isTerminalTab = (tab: WorkspaceTab | null | undefined): tab is TerminalTab =>
  tab?.kind === "terminal";

export const isGitTab = (tab: WorkspaceTab | null | undefined): tab is GitTab =>
  tab?.kind === "git";

export const isGitDiffTab = (tab: WorkspaceTab | null | undefined): tab is GitDiffTab =>
  tab?.kind === "git-diff";

export const isSettingsTab = (tab: WorkspaceTab | null | undefined): tab is SettingsTab =>
  tab?.kind === "settings";

export const isWidgetsTab = (tab: WorkspaceTab | null | undefined): tab is WidgetsTab =>
  tab?.kind === "widgets";

export const isTaskTab = (tab: WorkspaceTab | null | undefined): tab is TaskTab =>
  tab?.kind === "task";

export const isAppTab = (tab: WorkspaceTab | null | undefined): tab is AppTab =>
  tab?.kind === "app";

export const isLauncherTab = (tab: WorkspaceTab | null | undefined): tab is LauncherTab =>
  tab?.kind === "launcher";

export const isWebTab = (tab: WorkspaceTab | null | undefined): tab is WebTab =>
  tab?.kind === "web";

export const isNodeTab = (tab: WorkspaceTab | null | undefined): tab is Node =>
  !!tab && (tab.kind === "chat" || tab.kind === "file" || tab.kind === "space");

export const isOpenableSpace = (node: Node | null | undefined): node is Node =>
  !!node && node.kind !== "space";

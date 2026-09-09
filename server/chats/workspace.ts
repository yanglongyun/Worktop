// 工作区快照:界面此刻开着哪些标签、哪个激活、有没有分屏。
// 界面每次标签增删/切换/分屏变化都推一份(ws: workspace_state),这里只留最新的一份,
// 拼进 system prompt 的「# 工作区」段 —— 用户说「这个文件」「当前页面」时模型才知道指的是谁。
import { wcIdForTabId } from "../browser/host.js";

export type WorkspaceTabSnapshot = {
  id: string;
  kind: string;
  title: string;
  active?: boolean;
  /** 文件 / 文件夹 / 终端 cwd / git 仓库根 */
  path?: string;
  /** 网页地址 */
  url?: string;
  /** 应用 id */
  appId?: string;
};

export type WorkspaceSnapshot = {
  groups: { id: "main" | "side"; active: boolean; tabs: WorkspaceTabSnapshot[] }[];
};

let current: WorkspaceSnapshot | null = null;

const str = (v: unknown, max = 300) => String(v ?? "").slice(0, max);

export const setWorkspace = (raw: unknown) => {
  const groups = Array.isArray((raw as any)?.groups) ? (raw as any).groups : [];
  current = {
    groups: groups.slice(0, 2).map((g: any) => ({
      id: g?.id === "side" ? "side" : "main",
      active: !!g?.active,
      tabs: (Array.isArray(g?.tabs) ? g.tabs : []).slice(0, 60).map((t: any): WorkspaceTabSnapshot => ({
        id: str(t?.id), kind: str(t?.kind, 20), title: str(t?.title, 120), active: !!t?.active,
        path: t?.path ? str(t.path) : undefined, url: t?.url ? str(t.url, 500) : undefined, appId: t?.appId ? str(t.appId, 60) : undefined,
      })),
    })),
  };
};

export const getWorkspace = () => current;

const KIND_LABEL: Record<string, string> = {
  chat: "对话", "chat-start": "新对话", file: "文件", folder: "文件夹", terminal: "终端", web: "网页", app: "应用",
  git: "Git", "git-diff": "Git 差异", settings: "设置", widgets: "组件", task: "任务", skill: "技能", launcher: "新标签页",
};

const line = (t: WorkspaceTabSnapshot, chatId: string) => {
  const label = KIND_LABEL[t.kind] || t.kind;
  let body = t.title;
  if (t.kind === "file" || t.kind === "folder") body = t.path || t.title;
  else if (t.kind === "terminal") body = `${t.title}${t.path ? ` cwd=${t.path}` : ""}`;
  else if (t.kind === "web") {
    const wcId = wcIdForTabId(t.id);
    body = `${t.title} ${t.url || ""}${wcId != null ? `(tab_id ${wcId})` : ""}`;
  } else if (t.kind === "git" || t.kind === "git-diff") body = `${t.title}${t.path ? ` ${t.path}` : ""}`;
  else if (t.kind === "app") body = `${t.title}(${t.appId || ""})`;
  else if (t.kind === "chat" && t.id === chatId) body = `${t.title}(就是本对话)`;
  return `[${label}] ${body}${t.active ? " ←当前" : ""}`;
};

/** 渲染成 prompt 段落;没有快照(纯 API 调用、界面没连)时返回空串。 */
export const workspaceSection = (chatId: string) => {
  if (!current || !current.groups.length) return "";
  const split = current.groups.length > 1;
  const blocks = current.groups.map((g) => {
    const head = split ? `${g.id === "main" ? "左侧" : "右侧"}${g.active ? "(焦点)" : ""}:` : "";
    const rows = g.tabs.length ? g.tabs.map((t) => `  ${line(t, chatId)}`) : ["  (空)"];
    return (head ? head + "\n" : "") + rows.join("\n");
  });
  return `

# 工作区(用户此刻在界面上开着的标签)
${blocks.join("\n")}
- 「←当前」是用户正看着的标签;用户说「这个文件 / 这个页面 / 当前」多半指它。${split ? "\n- 已左右分屏,「焦点」是最近操作的那半区。" : ""}
- 网页标签后面的 tab_id 可直接给 browser 工具用,不必先 list。文件标签给的是完整路径,可直接 read。`;
};

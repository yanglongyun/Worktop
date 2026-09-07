import { SkillDocumentPanel } from "./panels/SkillDocumentPanel";
import type { Settings, SkillInfo, Node } from "../../api";
import { ChatPanel } from "../chat";
import { FilePanel } from "../files";
import { SettingsPanel } from "../settings";
import { WidgetsManager } from "../widgets/WidgetsManager";
import { AppPanel, EmptyPanel, GitDiffPanel, GitView, LauncherPanel, TaskPanel } from "./panels";
import { isAppTab, isGitDiffTab, isGitTab, isLauncherTab, isSettingsTab, isTaskTab, isWidgetsTab, isNodeTab, type WorkspaceGroupId, type WorkspaceTab } from "./types";

type Socket = {
  send: (m: any) => void;
  on: (t: string, fn: (p: any) => void) => () => void;
};

export function TabContent({
  tab,
  groupId,
  socket,
  drafts,
  fileRefreshKeys,
  gitRefreshKey,
  onFileChange,
  onFileSaved,
  onSelect,
  onOpenSkill,
  onOpenNav,
  onOpenSettings,
  onSettingsSaved,
  onGitChanged,
  onOpenGitDiff,
}: {
  tab: WorkspaceTab | null;
  groupId: WorkspaceGroupId;
  socket: Socket;
  drafts: Record<string, string>;
  fileRefreshKeys: Record<string, number>;
  gitRefreshKey: number;
  onFileChange: (id: string, value: string) => void;
  onFileSaved: (id: string) => void;
  onSelect: (n: Node) => void;
  onOpenSkill: (skill: SkillInfo) => void;
  onOpenNav?: () => void;
  onOpenSettings: () => void;
  onSettingsSaved?: (settings: Settings) => void;
  onGitChanged?: () => void;
  onOpenGitDiff: (root: string, path: string, staged?: boolean, commit?: string) => void;
}) {
  if (!tab) return <EmptyPanel />;

  // 终端不在这里:它和网页标签一样常驻挂载在 WorkspaceGroup(卸载 = 杀 PTY)

  if (isGitTab(tab)) {
    return (
      <GitView
        repoPath={tab.root}
        repoTitle={tab.title}
        refreshKey={gitRefreshKey}
        onOpenDiff={onOpenGitDiff}
        onChanged={onGitChanged}
      />
    );
  }

  if (isGitDiffTab(tab)) {
    return <GitDiffPanel tab={tab} refreshKey={gitRefreshKey} onChanged={onGitChanged} />;
  }

  if (isLauncherTab(tab)) {
    return <LauncherPanel tab={tab} groupId={groupId} />;
  }

  if (isSettingsTab(tab)) {
    return <SettingsPanel onSaved={onSettingsSaved} onOpenSkill={onOpenSkill} />;
  }

  if (tab.kind === "skill") return <SkillDocumentPanel key={tab.id} skill={tab.skill} />;

  if (isAppTab(tab)) {
    return <AppPanel tab={tab} socket={socket} />;
  }

  if (isTaskTab(tab)) {
    return <TaskPanel tab={tab} socket={socket} />;
  }

  if (isWidgetsTab(tab)) {
    return (
      <WidgetsManager />
    );
  }

  if (tab.kind === "chat-start" || (isNodeTab(tab) && tab.kind === "chat")) {
    return (
      <ChatPanel
        key={tab.id}
        node={tab}
        onSelect={onSelect}
        socket={socket}
        onOpenNav={onOpenNav}
        onOpenSettings={onOpenSettings}
        onCreated={(node, prompt, attachments) => window.dispatchEvent(new CustomEvent("worktop:chat-created", {
          detail: { tabId: tab.id, groupId, node, prompt, attachments },
        }))}
      />
    );
  }

  if (isNodeTab(tab) && tab.kind === "file") {
    return (
      <FilePanel
        key={tab.id}
        node={tab}
        draft={drafts[tab.id]}
        refreshKey={fileRefreshKeys[tab.id] || 0}
        onChange={(value) => onFileChange(tab.id, value)}
        onSaved={() => onFileSaved(tab.id)}
      />
    );
  }

  return <EmptyPanel />;
}

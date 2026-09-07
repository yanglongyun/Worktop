import { type Settings } from "../../api/settings";
import { type SkillInfo } from "../../api/skills";
import { type Chat } from "../../api/chats";
import { type FileNode } from "../../api/files";
import { TabBar } from "./TabBar";
import { TabContent } from "./TabContent";
import { isTerminalTab, isWebTab, type TabActions, type WorkspaceGroupState } from "./types";

type Socket = {
  send: (m: any) => void;
  on: (t: string, fn: (p: any) => void) => () => void;
};

/** 内容区的直通参数:App 装一次包,原样透传给 TabContent。 */
export type TabContentProps = {
  socket: Socket;
  drafts: Record<string, string>;
  fileRefreshKeys: Record<string, number>;
  gitRefreshKey: number;
  onFileChange: (id: string, value: string) => void;
  onFileSaved: (id: string) => void;
  onSelect: (n: (Chat | FileNode)) => void;
  onOpenSkill: (skill: SkillInfo) => void;
  onOpenSettings: () => void;
  onSettingsSaved?: (settings: Settings) => void;
  onGitChanged?: () => void;
  onOpenGitDiff: (root: string, path: string, staged?: boolean, commit?: string) => void;
};

const activeTabOf = (group: WorkspaceGroupState) =>
  group.tabs.find((tab) => tab.id === group.activeId) || null;

export function WorkspaceGroup({
  group,
  active,
  dirtyIds,
  showNavButton,
  showSideToggle,
  sideOpen,
  navOpen,
  onOpenNav,
  tabs,
  content,
}: {
  group: WorkspaceGroupState;
  active: boolean;
  dirtyIds: Set<string>;
  showNavButton?: boolean;
  showSideToggle?: boolean;
  sideOpen: boolean;
  navOpen?: boolean;
  onOpenNav?: () => void;
  tabs: TabActions;
  content: TabContentProps;
}) {
  const tab = activeTabOf(group);

  return (
    <section
      onMouseDown={() => tabs.focusGroup(group.id)}
      data-focus-group={group.id}
      data-tab-drop-group={group.id}
      data-tab-count={group.tabs.length}
      className={[
        "flex-1 min-w-0 min-h-0 flex flex-col bg-bg",
        group.id === "side" ? "border-l border-border" : "",
        active ? "outline outline-1 outline-accent/25 outline-offset-[-1px]" : "",
      ].join(" ")}
    >
      <TabBar
        tabs={group.tabs}
        activeId={group.activeId}
        groupId={group.id}
        dirtyIds={dirtyIds}
        previewId={group.previewId}
        actions={tabs}
        showSideToggle={showSideToggle}
        sideToggleOpen={sideOpen}
        onOpenNav={showNavButton ? onOpenNav : undefined}
        navOpen={navOpen}
      />
      {/* data-panel-host:常驻层(PersistentPanelLayer)按这块矩形投放本组的网页/终端。
          分组只决定「摆在哪、显不显」,webview/PTY 的生命都在常驻层 —— 跨分屏移动不死 */}
      <div data-panel-host={group.id} className="flex-1 min-h-0 flex flex-col relative">
        <TabContent
          tab={isWebTab(tab) || isTerminalTab(tab) ? null : tab}
          groupId={group.id}
          {...content}
          onOpenNav={showNavButton ? onOpenNav : undefined}
        />
      </div>
    </section>
  );
}

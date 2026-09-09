import { type Chat } from "../../api/chats";
import { type FileNode } from "../../api/files";
import { type SkillInfo } from "../../api/skills";
import { useCallback, useMemo, useRef, useState } from "react";
import { exactKey, hostKey } from "../../lib/urls";
import { isContentTab, chatStartTab, skillTab, gitTab, gitDiffTab, settingsTab, widgetsTab, taskTab, appTab, terminalTab, webTab, launcherTab, isWebTab, type WebTab, type WorkspaceGroupId, type WorkspaceGroupState, type WorkspaceTab } from "./types";

const patchTab = <T extends WorkspaceTab>(tab: T, patch: Partial<Omit<T, "id" | "kind">>): T => {
  const keys = Object.keys(patch) as (keyof typeof patch)[];
  return keys.every((key) => tab[key] === patch[key]) ? tab : { ...tab, ...patch };
};

type UseTabGroupsOptions = {
  canCloseTab?: (tab: WorkspaceTab) => boolean | Promise<boolean>;
  onTabClosed?: (tab: WorkspaceTab) => void;
};

const groupOrder: WorkspaceGroupId[] = ["main", "side"];

const emptyGroup = (id: WorkspaceGroupId): WorkspaceGroupState => ({
  id,
  tabs: [],
  activeId: null,
  previewId: null,
});

const otherGroup = (id: WorkspaceGroupId): WorkspaceGroupId => (id === "main" ? "side" : "main");

const activeTabOf = (group: WorkspaceGroupState) =>
  group.tabs.find((tab) => tab.id === group.activeId) || null;

/**
 * 新标签插在哪 —— **照 Chrome 的规矩**。
 *
 * 从某个标签点出来的(有 openerId),插在**来源标签之后、以及它已经开出来的
 * 那几个之后**;连开三个链接,它们会按点击顺序排在来源右边,而不是散在末尾。
 * 没有来源的(加号 / ⌘T / AI 开的)才排末尾。
 *
 * 为什么不图省事一律追加:在一个标签里点开链接,新页却跑到十个标签之外 ——
 * 用户得横跨整条标签栏去找刚点开的那一页,而且关掉它之后焦点也回不到原处。
 */
const insertAt = (tabs: WorkspaceTab[], tab: WorkspaceTab): number => {
  const openerId = isWebTab(tab) ? tab.openerId : undefined;
  if (!openerId) return tabs.length;
  const from = tabs.findIndex((t) => t.id === openerId);
  if (from === -1) return tabs.length; // 来源已经关了,退回末尾
  let at = from + 1;
  while (at < tabs.length && isWebTab(tabs[at]) && (tabs[at] as WebTab).openerId === openerId) at += 1;
  return at;
};

const upsertTab = (
  group: WorkspaceGroupState,
  tab: WorkspaceTab,
  preview = false,
  background = false,
): WorkspaceGroupState => {
  const existing = group.tabs.some((t) => t.id === tab.id);
  let tabs: WorkspaceTab[];
  if (existing) {
    tabs = group.tabs.map((t) => (t.id === tab.id ? tab : t));
  } else if (preview) {
    tabs = [...group.tabs.filter((t) => t.id !== group.previewId), tab];
  } else {
    tabs = [...group.tabs];
    tabs.splice(insertAt(tabs, tab), 0, tab);
  }
  return {
    ...group,
    tabs,
    // 后台打开(中键 / ⌘点击 / 右键「在新标签页打开」)不抢焦点,和 Chrome 一致
    activeId: background && !existing ? group.activeId : tab.id,
    previewId: preview ? tab.id : group.previewId === tab.id ? null : group.previewId,
  };
};

export function useTabGroups({ canCloseTab = () => true, onTabClosed = () => {} }: UseTabGroupsOptions = {}) {
  const [groups, setGroups] = useState<Record<WorkspaceGroupId, WorkspaceGroupState>>({
    main: emptyGroup("main"),
    side: emptyGroup("side"),
  });
  const [activeGroupId, setActiveGroupId] = useState<WorkspaceGroupId>("main");
  const [sideOpen, setSideOpen] = useState(false);

  const optionsRef = useRef({ canCloseTab, onTabClosed });
  const groupsRef = useRef(groups);
  const activeGroupRef = useRef(activeGroupId);
  optionsRef.current = { canCloseTab, onTabClosed };
  groupsRef.current = groups;
  activeGroupRef.current = activeGroupId;

  const visibleGroups = useMemo(() => {
    const main = groups.main;
    const side = groups.side;
    return sideOpen ? [main, side] : [main];
  }, [groups, sideOpen]);

  const allTabs = useMemo(
    () => groupOrder.flatMap((id) => groups[id].tabs),
    [groups],
  );

  /** 全部分组(含隐藏的 side),有序:常驻层按它持有网页/终端。 */
  const allGroups = useMemo(() => groupOrder.map((id) => groups[id]), [groups]);

  const activeGroup = groups[activeGroupId];
  const activeTab = activeTabOf(activeGroup);

  const focusGroup = useCallback((groupId: WorkspaceGroupId) => setActiveGroupId(groupId), []);

  const toggleSideGroup = useCallback(() => {
    setSideOpen((open) => {
      const next = !open;
      setActiveGroupId(next ? "side" : "main");
      return next;
    });
  }, []);

  const openTab = useCallback((
    tab: WorkspaceTab,
    opts: { groupId?: WorkspaceGroupId; side?: boolean; preview?: boolean; background?: boolean; keepFocus?: boolean } = {},
  ) => {
    const targetId = opts.side ? otherGroup(activeGroupRef.current) : opts.groupId || activeGroupRef.current;
    if (targetId === "side") setSideOpen(true);
    setGroups((prev) => ({
      ...prev,
      [targetId]: upsertTab(
        prev[targetId],
        tab,
        !!opts.preview && isContentTab(tab) && tab.kind === "file",
        !!opts.background,
      ),
    }));
    // background 完全不激活;keepFocus 激活了新标签(在目标半区可见)但不把焦点从当前半区抢走。
    if (!opts.background && !opts.keepFocus) setActiveGroupId(targetId);
  }, []);

  const openNode = useCallback((node: (Chat | FileNode) | null, opts: { groupId?: WorkspaceGroupId; side?: boolean; preview?: boolean } = {}) => {
    if (!node || node.kind === "folder") return;
    openTab(node, opts);
  }, [openTab]);

  const openChatStart = useCallback(() => {
    openTab(chatStartTab());
  }, [openTab]);

  const openTerminal = useCallback((cwd: string, title = "Terminal", opts: { groupId?: WorkspaceGroupId; side?: boolean; command?: string } = {}) => {
    openTab(terminalTab(cwd, title, opts.command), opts);
  }, [openTab]);

  const openGit = useCallback((root: string, title = "Git", opts: { groupId?: WorkspaceGroupId; side?: boolean } = {}) => {
    openTab(gitTab(root, title), opts);
  }, [openTab]);

  const openGitDiff = useCallback((root: string, filePath: string, staged = false, opts: { groupId?: WorkspaceGroupId; side?: boolean; commit?: string } = {}) => {
    openTab(gitDiffTab(root, filePath, staged, opts.commit || ""), opts);
  }, [openTab]);

  const openSkill = useCallback((skill: SkillInfo) => { openTab(skillTab(skill)); }, [openTab]);

  const openSettings = useCallback((opts: { groupId?: WorkspaceGroupId; side?: boolean } = {}) => {
    openTab(settingsTab(), opts);
  }, [openTab]);

  const openWidgets = useCallback((opts: { groupId?: WorkspaceGroupId; side?: boolean } = {}) => {
    openTab(widgetsTab(), opts);
  }, [openTab]);

  const openTask = useCallback((taskId: string, title: string, opts: { groupId?: WorkspaceGroupId; side?: boolean } = {}) => {
    openTab(taskTab(taskId, title), opts);
  }, [openTab]);

  const openApp = useCallback((appId: string, name: string, opts: { groupId?: WorkspaceGroupId; side?: boolean } = {}) => {
    openTab(appTab(appId, name), opts);
  }, [openTab]);

  const findWebTab = useCallback((url: string): { groupId: WorkspaceGroupId; tab: WebTab } | null => {
    const exact = exactKey(url);
    const host = hostKey(url);
    for (const groupId of groupOrder) {
      const tabs = groupsRef.current[groupId].tabs;
      const tab =
        tabs.find((t): t is WebTab => isWebTab(t) && exactKey(t.url) === exact)
        || (host ? tabs.find((t): t is WebTab => isWebTab(t) && hostKey(t.url) === host) : undefined);
      if (tab) return { groupId, tab };
    }
    return null;
  }, []);

  /** 网页标签的标题/地址/图标跟着页面走(page-title-updated / did-navigate / page-favicon-updated)。无变化返回 prev,别造渲染。 */
  const updateWebTab = useCallback((id: string, patch: Partial<Pick<WebTab, "title" | "url" | "favicon">>) => {
    setGroups((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const groupId of groupOrder) {
        const group = prev[groupId];
        let groupChanged = false;
        const tabs = group.tabs.map((tab) => {
          if (tab.id !== id || !isWebTab(tab)) return tab;
          if (
            (patch.title === undefined || tab.title === patch.title)
            && (patch.url === undefined || tab.url === patch.url)
            && (patch.favicon === undefined || tab.favicon === patch.favicon)
          ) return tab;
          groupChanged = true;
          return { ...tab, ...patch };
        });
        if (groupChanged) {
          next[groupId] = { ...group, tabs };
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, []);

  const activateTab = useCallback((groupId: WorkspaceGroupId, id: string, keepFocus = false) => {
    setGroups((prev) => ({ ...prev, [groupId]: { ...prev[groupId], activeId: id } }));
    // keepFocus:把标签翻到它所在半区的前台,但不把整体焦点抢过去 —— 用户在另一半区(比如聊天)不被打断。
    if (!keepFocus) setActiveGroupId(groupId);
  }, []);

  /** 不知道在哪个组时按 id 激活(browser 截图前把网页标签翻到前台用)。 */
  const activateTabById = useCallback((id: string) => {
    for (const groupId of groupOrder) {
      if (groupsRef.current[groupId].tabs.some((tab) => tab.id === id)) {
        activateTab(groupId, id);
        return true;
      }
    }
    return false;
  }, [activateTab]);

  /**
   * 打开网页标签。同站已开就聚焦不重复开,身份不看协议:
   * 先精确键(主机+路径+query,忽略协议/www/尾斜杠),再站点键(主机)兜底。
   * 返回被聚焦的已有标签(null = 新开了一个)—— AI 发起的 open 靠它兑现 token。
   */
  const openLauncher = useCallback((opts: { groupId?: WorkspaceGroupId; side?: boolean } = {}) => {
    openTab(launcherTab(), opts);
  }, [openTab]);

  /** 就地换身:同位置把 oldId 换成新标签 —— 新标签页 Enter 后变成对话/网站,位置不跳。 */
  const openWeb = useCallback((
    url: string,
    title?: string,
    opts: { groupId?: WorkspaceGroupId; side?: boolean; token?: string; openerId?: string; background?: boolean; fresh?: boolean; keepFocus?: boolean } = {},
  ): WebTab | null => {
    const exact = exactKey(url);
    const host = hostKey(url);
    // fresh:用户在网页里点出来的新标签(target=_blank / window.open)。真浏览器每次都开新页;
    // 若按站点去重,同站已开时点击只会「聚焦旧标签」—— 在后台里点「新的创作」看起来就是毫无反应。
    for (const groupId of opts.fresh ? [] : groupOrder) {
      const tabs = groupsRef.current[groupId].tabs;
      const existing =
        tabs.find((tab): tab is WebTab => isWebTab(tab) && exactKey(tab.url) === exact)
        || (host ? tabs.find((tab): tab is WebTab => isWebTab(tab) && hostKey(tab.url) === host) : undefined);
      if (existing) {
        if (!opts.background) activateTab(groupId, existing.id, opts.keepFocus); // 后台打开:已有的也不抢前台
        return existing;
      }
    }
    openTab(webTab(url, title, opts.token, opts.openerId), opts);
    return null;
  }, [openTab, activateTab]);

  const reorderTabs = useCallback((groupId: WorkspaceGroupId, tabs: WorkspaceTab[]) => {
    setGroups((prev) => ({ ...prev, [groupId]: { ...prev[groupId], tabs } }));
  }, []);

  const closeTabs = useCallback(async (groupId: WorkspaceGroupId, ids: string[]) => {
    let group = groupsRef.current[groupId];
    const closeSet = new Set(ids);
    let tabsToClose = group.tabs.filter((tab) => closeSet.has(tab.id));
    if (!tabsToClose.length) return;
    // 逐个询问(未保存确认可能是异步弹窗);任何一个拒绝就整体不关
    for (const tab of tabsToClose) {
      if (!(await optionsRef.current.canCloseTab(tab))) return;
    }
    group = groupsRef.current[groupId]; // 弹窗期间标签可能变了,重取
    tabsToClose = group.tabs.filter((tab) => closeSet.has(tab.id));
    if (!tabsToClose.length) return;
    const nextTabs = group.tabs.filter((tab) => !closeSet.has(tab.id));
    const activeWasClosed = !!group.activeId && closeSet.has(group.activeId);
    const firstClosedIdx = group.tabs.findIndex((tab) => closeSet.has(tab.id));
    setGroups((prev) => ({
      ...prev,
      [groupId]: {
        ...prev[groupId],
        tabs: nextTabs,
        activeId: activeWasClosed
          ? nextTabs.length ? (nextTabs[firstClosedIdx] ?? nextTabs[firstClosedIdx - 1] ?? nextTabs[0]).id : null
          : prev[groupId].activeId,
        previewId: closeSet.has(prev[groupId].previewId || "") ? null : prev[groupId].previewId,
      },
    }));
    tabsToClose.forEach(optionsRef.current.onTabClosed);
  }, []);

  const closeTab = useCallback((groupId: WorkspaceGroupId, id: string) => {
    const group = groupsRef.current[groupId];
    const idx = group.tabs.findIndex((tab) => tab.id === id);
    if (idx === -1) return;
    closeTabs(groupId, [id]);
  }, [closeTabs]);

  /** 原位替换(新标签页 → 选中的对话)。目标已经开着就不造第二份:关掉这张,切到已有的那张。 */
  const replaceTab = useCallback((groupId: WorkspaceGroupId, oldId: string, tab: WorkspaceTab) => {
    for (const gid of groupOrder) {
      const existing = groupsRef.current[gid].tabs.find((t) => t.id === tab.id && t.id !== oldId);
      if (existing) {
        closeTab(groupId, oldId);
        activateTab(gid, existing.id);
        return;
      }
    }
    setGroups((prev) => {
      const group = prev[groupId];
      const idx = group.tabs.findIndex((t) => t.id === oldId);
      if (idx === -1) return prev;
      const tabs = [...group.tabs];
      tabs[idx] = tab;
      return { ...prev, [groupId]: { ...group, tabs, activeId: tab.id } };
    });
  }, [closeTab, activateTab]);

  const moveTab = useCallback((fromId: WorkspaceGroupId, tabId: string, toId = otherGroup(fromId), toIndex?: number) => {
    const from = groupsRef.current[fromId];
    const tab = from.tabs.find((t) => t.id === tabId);
    if (!tab) return;
    if (toId === "side") setSideOpen(true);
    setGroups((prev) => {
      const source = prev[fromId];
      const target = prev[toId];
      const idx = source.tabs.findIndex((t) => t.id === tabId);
      const sourceTabs = source.tabs.filter((t) => t.id !== tabId);
      const withoutExisting = target.tabs.filter((t) => t.id !== tabId);
      const insertAt = Math.max(0, Math.min(withoutExisting.length, toIndex ?? withoutExisting.length));
      const targetTabs = [...withoutExisting];
      targetTabs.splice(insertAt, 0, tab);
      return {
        ...prev,
        [fromId]: {
          ...source,
          tabs: sourceTabs,
          activeId: source.activeId === tabId
            ? sourceTabs.length ? (sourceTabs[idx] ?? sourceTabs[idx - 1]).id : null
            : source.activeId,
          previewId: source.previewId === tabId ? null : source.previewId,
        },
        [toId]: {
          ...target,
          tabs: targetTabs,
          activeId: tab.id,
          previewId: target.previewId === tab.id ? null : target.previewId,
        },
      };
    });
    setActiveGroupId(toId);
  }, []);

  const closeOthers = useCallback((groupId: WorkspaceGroupId, keepId: string) => {
    const group = groupsRef.current[groupId];
    closeTabs(groupId, group.tabs.filter((tab) => tab.id !== keepId).map((tab) => tab.id));
  }, [closeTabs]);

  const closeToRight = useCallback((groupId: WorkspaceGroupId, afterId: string) => {
    const group = groupsRef.current[groupId];
    const idx = group.tabs.findIndex((tab) => tab.id === afterId);
    if (idx < 0) return;
    closeTabs(groupId, group.tabs.slice(idx + 1).map((tab) => tab.id));
  }, [closeTabs]);

  const closeGroup = useCallback((groupId: WorkspaceGroupId) => {
    const group = groupsRef.current[groupId];
    closeTabs(groupId, group.tabs.map((tab) => tab.id));
  }, [closeTabs]);

  // 无变化必须返回 prev:这个函数被 chats_changed / 运行事件高频调用,曾经的版本
  // 无条件造新 state → 依赖 activeTab 引用的 effect 重跑 → 再 fetch 再 setState ——
  // 「fetch+渲染」死循环,四个进程一起烧 CPU 的元凶。
  const updateContentTab = useCallback((id: string, update: (tab: WorkspaceTab) => WorkspaceTab) => {
    setGroups((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const groupId of groupOrder) {
        const group = prev[groupId];
        let groupChanged = false;
        const tabs = group.tabs.map((tab) => {
          if (tab.id !== id) return tab;
          const updated = update(tab);
          if (updated !== tab) groupChanged = true;
          return updated;
        });
        if (groupChanged) {
          next[groupId] = { ...group, tabs };
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, []);

  const updateChatTab = useCallback((id: string, patch: Partial<Omit<Chat, "id" | "kind">>) => {
    updateContentTab(id, (tab) => tab.kind === "chat" ? patchTab(tab, patch) : tab);
  }, [updateContentTab]);

  const updateFileTab = useCallback((id: string, patch: Partial<Omit<FileNode, "id" | "kind">>) => {
    updateContentTab(id, (tab) => tab.kind === "file" || tab.kind === "folder" ? patchTab(tab, patch) : tab);
  }, [updateContentTab]);

  const removeNodeTab = useCallback((id: string) => {
    for (const groupId of groupOrder) closeTab(groupId, id);
  }, [closeTab]);

  const pinPreviewTab = useCallback((id: string) => {
    setGroups((prev) => {
      if (groupOrder.every((groupId) => prev[groupId].previewId !== id)) return prev; // 不是预览标签,别造渲染
      const next = { ...prev };
      for (const groupId of groupOrder) {
        next[groupId] = {
          ...next[groupId],
          previewId: next[groupId].previewId === id ? null : next[groupId].previewId,
        };
      }
      return next;
    });
  }, []);

  const closeAll = useCallback(async () => {
    const currentTabs = groupOrder.flatMap((id) => groupsRef.current[id].tabs);
    for (const tab of currentTabs) {
      if (!(await optionsRef.current.canCloseTab(tab))) return;
    }
    setGroups({ main: emptyGroup("main"), side: emptyGroup("side") });
    currentTabs.forEach(optionsRef.current.onTabClosed);
    setActiveGroupId("main");
  }, []);

  return {
    sideOpen,
    visibleGroups,
    allGroups,
    allTabs,
    activeGroupId,
    activeGroup,
    activeTab,
    activeNode: isContentTab(activeTab) ? activeTab : null,
    focusGroup,
    toggleSideGroup,
    openNode,
    openTerminal,
    openGit,
    openGitDiff,
    openSettings,
    openSkill,
    openWidgets,
    openTask,
    openApp,
    findWebTab,
    openLauncher,
    openChatStart,
    replaceTab,
    openWeb,
    updateWebTab,
    activateTab,
    activateTabById,
    reorderTabs,
    closeTab,
    moveTab,
    closeOthers,
    closeToRight,
    closeGroup,
    updateChatTab,
    updateFileTab,
    removeNodeTab,
    pinPreviewTab,
    closeAll,
  };
}

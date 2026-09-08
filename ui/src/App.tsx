import { type GitRepositoryStatus } from "./api/git";
import { type Chat, chatsApi } from "./api/chats";
import { type FileNode, filesApi } from "./api/files";
import { widgetsApi } from "./api/widgets";
import { chatStartTab } from "./components/workspace/types";
import { useCallback, useEffect, useRef, useState } from "react";
import { useSocket } from "./ws";
import { tabForWcId, useBrowserHost, wcIdForTab } from "./lib/webviewHost";
import { EVENTS } from "../../server/shared/events";
import { QuickOpen, CommandPalette, type Command } from "./components/command";
import { PanelHost } from "./components/sidebar";
import { WorkspaceLayout, isAppTab, isSettingsTab, isContentTab, useTabGroups, terminalTab, webTab, type TabActions, type WorkspaceGroupId } from "./components/workspace";
import { toNavigableUrl } from "./lib/search";
import { BrowsingPrompts, DialogHost, dialog, showToast, SystemNotices, ToastHost } from "./components/ui";
import { FileText, Folder, FolderPlus, Bot, Globe, LayoutGrid, Search, Settings as SettingsIcon, X, PanelRight } from "./components/ui/icons";

export function App() {
  const socket = useSocket();
  useBrowserHost(socket); // browser 工具的执行端:应答 server 广播的网页标签指令(仅 Electron)
  const [treeRefresh, setTreeRefresh] = useState(0);
  const treeBumpTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [gitRefreshKey, setGitRefreshKey] = useState(0);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [desktopNavOpen, setDesktopNavOpen] = useState(true);
  const [quickOpen, setQuickOpen] = useState(false);
  const [cmdOpen, setCmdOpen] = useState(false);
  const [fileRefreshKeys, setFileRefreshKeys] = useState<Record<string, number>>({});
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [dirtyIds, setDirtyIds] = useState<Set<string>>(new Set());
  const [selectedNode, setSelectedNode] = useState<(Chat | FileNode) | null>(null);

  const onFileSaved = (id: string) => {
    setDirtyIds((s) => { const n = new Set(s); n.delete(id); return n; });
    setDrafts((d) => { const n = { ...d }; delete n[id]; return n; });
  };

  const tabGroups = useTabGroups({
    canCloseTab: (tab) => tab.kind !== "file" || !dirtyIds.has(tab.id) || dialog.confirm("有未保存的修改,确定关闭?", { danger: true, confirmText: "关闭" }),
    onTabClosed: (tab) => {
      if (tab.kind === "file") onFileSaved(tab.id);
      if (tab.kind === "chat-start") localStorage.removeItem(`worktop.draft:${tab.id}`);
    },
  });

  // 文件未保存草稿(切标签不丢)+ 脏标记
  const onFileChange = (id: string, val: string) => {
    setDrafts((d) => ({ ...d, [id]: val }));
    setDirtyIds((s) => (s.has(id) ? s : new Set(s).add(id)));
    tabGroups.pinPreviewTab(id);
  };

  const allTabsRef = useRef(tabGroups.allTabs);
  const activeTabRef = useRef(tabGroups.activeTab);
  const dirtyRef = useRef<Set<string>>(new Set());
  allTabsRef.current = tabGroups.allTabs;
  activeTabRef.current = tabGroups.activeTab;
  dirtyRef.current = dirtyIds;
  const activeNode = tabGroups.activeNode;
  const openNode = (n: (Chat | FileNode) | null, opts: { preview?: boolean; side?: boolean; groupId?: "main" | "side" } = {}) => {
    setSelectedNode(n);
    tabGroups.openNode(n, opts);
  };
  const currentCreateParentId = () => {
    const node = selectedNode || activeNode;
    if (!node || node.kind === "chat") return null;
    return node.kind === "folder" ? node.id : node.parent_id;
  };
  const openTerminal = (n: FileNode, opts: { command?: string; titlePrefix?: string } = {}) => {
    setSelectedNode(n);
    const cwdHint = n.id;
    const name = n.kind === "folder" ? n.title : n.parent_id?.split("/").filter(Boolean).pop() || n.title;
    const title = `${opts.titlePrefix || "Terminal"}: ${name}`;
    tabGroups.openTerminal(cwdHint, title, { command: opts.command });
  };
  const openSettings = () => tabGroups.openSettings();
  const openWidgets = () => tabGroups.openWidgets();
  const openApp = (appId: string, name: string) => tabGroups.openApp(appId, name);
  const openWebTab = (url: string, title?: string) => tabGroups.openWeb(url, title);

  const refreshGit = useCallback(() => setGitRefreshKey((n) => n + 1), []);
  const openGit = (repo: GitRepositoryStatus) => {
    if (!repo.root) return;
    tabGroups.openGit(repo.root, repo.fileRootTitle || "Git");
  };

  // 树相关 WS 事件 → 刷新树/状态点(节流,流式时 message 事件很密)
  useEffect(() => {
    // 节流定时器放 ref:effect 若因依赖变化重跑,cleanup 不会把「排队中的刷新」
    // 一并清掉 —— 从前 timer 在 effect 闭包里,App 一重渲染事件就被静默吞没
    const bump = () => {
      if (treeBumpTimer.current) return;
      treeBumpTimer.current = setTimeout(() => { treeBumpTimer.current = null; setTreeRefresh((n) => n + 1); }, 300);
    };
    // 新消息进邮箱 / 轮次终局 / 会话列表变了 → 未读点、状态点要跟上(流式增量不刷,太密)
    const triggers = ["tree_changed", "chats_changed", EVENTS.INPUT, EVENTS.RUN_DONE, EVENTS.RUN_ABORTED, EVENTS.RUN_ERROR];
    const offs = triggers.map((t) => socket.on(t, bump));
    return () => { offs.forEach((f) => f()); };
  }, [socket]);

  // 对话标签页上的状态点/未读点:跟着运行事件走(对话不在文件树上)
  useEffect(() => {
    const set = (id: string, patch: Partial<Chat>) => tabGroups.updateChatTab(String(id), patch);
    // 标签页存的是 node 快照 —— 自动取名/重命名后把新标题同步过去(挂载时也对齐一次)
    const syncTitles = () => chatsApi.listChats().then((r) => {
      for (const a of r.chats) set(a.id, { title: a.title });
    }).catch(() => {});
    syncTitles();
    const offs = [
      socket.on("widget_open_url", (p: any) => { if (p?.url) openWebTab(String(p.url)); }),
      socket.on("widget_toast", (p: any) => { if (p?.message) showToast(String(p.message)); }),
      socket.on("widget_confirm", (p: any) => {
        if (!p?.requestId || !p?.message) return;
        void dialog.confirm(String(p.message)).then((ok) =>
          widgetsApi.widgetConfirmResult(String(p.requestId), ok).catch(() => {}));
      }),
      // 应用的 /apps/notify:此前后端 emit 了没人接,通知消失于无形
      // 用户按了「停止」:那张应用标签留着也是个死壳,直接关掉(闲置回收不关)
      socket.on("app_status", (p: any) => {
        if (p?.status !== "stopped" || p?.reason !== "manual") return;
        for (const group of tabGroups.allGroups) {
          for (const tab of group.tabs) {
            if (isAppTab(tab) && tab.appId === String(p.appId)) tabGroups.closeTab(group.id, tab.id);
          }
        }
      }),
      socket.on("app_notify", (p: any) => { if (p?.text) showToast(`${p.appName || p.appId || "应用"}:${p.text}`); }),
      socket.on("chats_changed", syncTitles),
      socket.on(EVENTS.RUN_START, (p: any) => set(p.chatId, { status: "running" })),
      socket.on(EVENTS.RUN_DONE, (p: any) => set(p.chatId, { status: "idle" })),
      socket.on(EVENTS.RUN_ABORTED, (p: any) => set(p.chatId, { status: "idle" })),
      socket.on(EVENTS.RUN_ERROR, (p: any) => set(p.chatId, { status: "error" })),
      socket.on(EVENTS.INPUT, (p: any) => {
        const active = activeTabRef.current; // 用 ref 读:activeTab 进依赖会让本 effect 每次 setState 后重跑
        if (active && isContentTab(active) && active.id === p.chatId) return; // 正看着呢,不算未读
        set(p.chatId, { unread: true });
      }),
    ];
    return () => { offs.forEach((f) => f()); };
  }, [socket, tabGroups.updateChatTab]);

  // 标签与 WS 联动:重命名/删除时同步标签
  useEffect(() => {
    const off = socket.on("tree_changed", (p: any) => {
      refreshGit();
      // 变了哪些路径:watcher / write / edit / 树操作都会带;bash 说不清(没有 paths)就全刷。
      // 标签的 id 就是绝对路径:相等命中;路径是它的上级目录(改名/移动)也命中。
      const paths: string[] | null = Array.isArray(p?.paths) ? p.paths.map(String)
        : p?.item?.id ? [String(p.item.id)] : p?.reason === "deleted" && p?.id ? [String(p.id)] : null;
      const hit = (tabId: string) => !paths || paths.some((x) => x === tabId || tabId.startsWith(x.endsWith("/") ? x : x + "/"));
      setFileRefreshKeys((prev) => {
        let changed = false;
        const next = { ...prev };
        for (const t of allTabsRef.current) {
          if (!isContentTab(t)) continue;
          if (t.kind !== "file" || dirtyRef.current.has(t.id) || !hit(t.id)) continue;
          next[t.id] = (next[t.id] || 0) + 1;
          changed = true;
        }
        return changed ? next : prev;
      });
      if (p?.item) {
        tabGroups.updateFileTab(p.item.id, p.item);
      } else if (p?.reason === "deleted" && p?.id) {
        tabGroups.removeNodeTab(p.id);
      }
    });
    return off;
  }, [refreshGit, socket, tabGroups.removeNodeTab, tabGroups.updateFileTab]);

  // browser open:AI 要开一个网页标签 —— **后台打开**,在当前分组里正常开一个标签但不抢前台:
  // 用户可能正在别的对话里干活,AI 开页不该把人的焦点夺走。带 token 打开,webview 注册时兑现给 server;
  // 同站已开则复用现有标签(同样不聚焦),并用它的 wcId 带 token 重注册,工具调用同样兑现
  useEffect(() => {
    const off = socket.on("web_tab_open", (p: any) => {
      if (!p?.url) return;
      const token = p.token ? String(p.token) : undefined;
      const existing = tabGroups.openWeb(String(p.url), undefined, { token, background: true });
      if (existing && token) {
        const wcId = wcIdForTab(existing.id);
        if (wcId != null) {
          socket.send({ type: "web_tab_register", wcId, tabId: existing.id, url: existing.url, title: existing.title, token });
        }
      }
    });
    return off;
  }, [socket, tabGroups.openWeb]);

  // 壳里的新标签请求:webview 里 target=_blank / 中键 / 右键「在新标签页打开」,
  // 以及宿主界面被外链导航时的兜底 —— 都落到这里开一个网页标签
  useEffect(() => {
    const onOpenTab = (e: Event) => {
      const detail = (e as CustomEvent).detail || {};
      const url = String(detail.url || "");
      if (!url) return;
      // 壳只认得 webContents,这里翻成标签 id —— 新标签要插在来源标签之后
      const openerId = typeof detail.openerWcId === "number" ? tabForWcId(detail.openerWcId) : null;
      tabGroups.openWeb(url, undefined, {
        openerId: openerId || undefined,
        background: !!detail.background,
        fresh: true,
      });
    };
    window.addEventListener("worktop:open-web-tab", onOpenTab);
    return () => window.removeEventListener("worktop:open-web-tab", onOpenTab);
  }, [tabGroups.openWeb]);

  // browser screenshot:截图前把目标网页标签翻到前台(隐藏的 <webview> 画不出图,capturePage 会挂起)
  useEffect(() => {
    const onActivate = (e: Event) => {
      const tabId = String((e as CustomEvent).detail?.tabId || "");
      if (tabId) tabGroups.activateTabById(tabId);
    };
    window.addEventListener("worktop:web-activate", onActivate);
    return () => window.removeEventListener("worktop:web-activate", onActivate);
  }, [tabGroups.activateTabById]);

  // 全局快捷键:⌘P 快开 / ⌘⇧P 命令面板
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "p") {
        e.preventDefault();
        if (e.shiftKey) { setCmdOpen((v) => !v); setQuickOpen(false); }
        else { setQuickOpen((v) => !v); setCmdOpen(false); }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // 标签页快捷键:⌘W 关标签(Electron 由菜单转发 worktop:close-tab)、
  // Ctrl(+Shift)+Tab / ⌘⇧[ ] 在当前分组内循环切换
  useEffect(() => {
    const cycleTab = (dir: number) => {
      const group = tabGroups.activeGroup;
      if (!group.tabs.length) return;
      const idx = Math.max(0, group.tabs.findIndex((t) => t.id === group.activeId));
      const next = group.tabs[(idx + dir + group.tabs.length) % group.tabs.length];
      if (next) tabGroups.activateTab(group.id, next.id);
    };
    const closeActiveTab = () => {
      const id = tabGroups.activeGroup.activeId;
      if (id) tabGroups.closeTab(tabGroups.activeGroupId, id);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Tab" && e.ctrlKey) { e.preventDefault(); cycleTab(e.shiftKey ? -1 : 1); return; }
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && ["[", "]", "{", "}"].includes(e.key)) {
        e.preventDefault();
        cycleTab(e.key === "]" || e.key === "}" ? 1 : -1);
        return;
      }
      // dev 纯浏览器里 ⌘W/⌘T 被浏览器保留,拦不住;Electron 走菜单转发,这里兜非 mac 的 Ctrl+W/T
      if (e.ctrlKey && !e.metaKey && !e.shiftKey && e.key.toLowerCase() === "w") { e.preventDefault(); closeActiveTab(); return; }
      if (e.ctrlKey && !e.metaKey && !e.shiftKey && e.key.toLowerCase() === "t") { e.preventDefault(); tabGroups.openLauncher(); return; }
    };
    const onCloseTab = () => closeActiveTab();
    window.addEventListener("keydown", onKey);
    window.addEventListener("worktop:close-tab", onCloseTab);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("worktop:close-tab", onCloseTab);
    };
  }, [tabGroups.activeGroup, tabGroups.activeGroupId, tabGroups.activateTab, tabGroups.closeTab]);

  // 在当前选中工作区/文件夹里新建(命令面板用)。
  // 对话零打扰直接建(默认「未命名对话」,首条消息后系统自动取名);文件类名字走 prompt
  const createAtCurrentTarget = async (kind: "folder" | "chat" | "file") => {
    try {
      const parentId = currentCreateParentId() || undefined;
      if (kind === "chat") {
        tabGroups.openChatStart();
        return;
      }
      const title = await dialog.prompt("", {
        title: `新建${kind === "folder" ? "文件夹" : "文件"}`,
        placeholder: kind === "folder" ? "文件夹名…" : "文件名…",
        confirmText: "创建",
      });
      if (!title || !title.trim()) return;
      const r = await filesApi.createNode({ kind, title: title.trim(), parentId });
      openNode(r.item);
      setTreeRefresh((n) => n + 1);
    } catch (e: any) {
      void dialog.alert(e.message || "新建失败");
    }
  };

  const addRoot = async () => {
    setMobileNavOpen(true);
    setDesktopNavOpen(true);
    window.dispatchEvent(new Event("worktop:add-root"));
  };

  // 新标签页:+ / ⌘T 打开一个空白页;Enter 后**就地转身** —— 文字变对话
  // (文字即首条消息),网址变网页标签(同站已开则聚焦并退场)。
  // LauncherPanel 只发事件,裁决全在这里 —— 面板不该知道对话是怎么建的。
  useEffect(() => {
    const onNewTab = () => tabGroups.openLauncher();
    const onNewChat = () => tabGroups.openChatStart();
    const onChatCreated = (e: Event) => {
      const { tabId, node, prompt, attachments } = (e as CustomEvent).detail;
      // 标签可能在请求期间被拖到另一半区,按当前实际位置替换。
      const group = tabGroups.allGroups.find((g) => g.tabs.some((t) => t.id === tabId));
      if (group) tabGroups.replaceTab(group.id, tabId, node);
      setSelectedNode(node);
      socket.send({ type: "send", chatId: node.id, prompt, attachments });
      setTreeRefresh((n) => n + 1);
    };
    const onLaunch = (e: Event) => {
      const { tabId, groupId, value, kind } = ((e as CustomEvent).detail || {}) as { tabId?: string; groupId?: WorkspaceGroupId; value?: string; kind?: "chat" | "web" | "term" };
      if (!tabId || !groupId) return;
      const input = String(value || "").trim();
      if (kind === "term") {
        tabGroups.replaceTab(groupId, tabId, terminalTab("", "终端", input || undefined));
        return;
      }
      if (kind === "web") {
        if (!input) return;
        // 网址卡:像地址栏 —— 是网址就打开,不是就交给设置里选的搜索引擎
        const url = toNavigableUrl(input);
        const existing = tabGroups.findWebTab(url);
        if (existing) {
          // 同站已开:别开第二个,关掉这张空白页去聚焦那个
          tabGroups.closeTab(groupId, tabId);
          tabGroups.activateTab(existing.groupId, existing.tab.id);
        } else {
          tabGroups.replaceTab(groupId, tabId, webTab(url));
        }
        return;
      }
      tabGroups.replaceTab(groupId, tabId, chatStartTab(input, !!input));
    };
    const onLaunchClose = (e: Event) => {
      const { tabId, groupId } = ((e as CustomEvent).detail || {}) as { tabId?: string; groupId?: WorkspaceGroupId };
      if (tabId && groupId) tabGroups.closeTab(groupId, tabId);
    };
    const onLaunchOpen = (e: Event) => {
      const { tabId, groupId, node } = ((e as CustomEvent).detail || {}) as { tabId?: string; groupId?: WorkspaceGroupId; node?: (Chat | FileNode) };
      if (!tabId || !groupId || !node) return;
      setSelectedNode(node);
      tabGroups.replaceTab(groupId, tabId, node);
    };
    const onLaunchApp = (e: Event) => {
      const { tabId, groupId, appId, name } = ((e as CustomEvent).detail || {}) as { tabId?: string; groupId?: WorkspaceGroupId; appId?: string; name?: string };
      if (!tabId || !groupId || !appId) return;
      tabGroups.closeTab(groupId, tabId);
      openApp(appId, name || appId);
    };
    const onLaunchCreate = (e: Event) => {
      const { tabId, groupId, kind } = ((e as CustomEvent).detail || {}) as { tabId?: string; groupId?: WorkspaceGroupId; kind?: string };
      if (tabId && groupId) tabGroups.closeTab(groupId, tabId);
      if (kind === "file") { void createAtCurrentTarget("file"); return; }
      if (kind === "terminal") {
        tabGroups.openTerminal("", "终端");
      }
    };
    window.addEventListener("worktop:new-tab", onNewTab);
    window.addEventListener("worktop:new-chat", onNewChat);
    window.addEventListener("worktop:chat-created", onChatCreated);
    window.addEventListener("worktop:launch", onLaunch);
    window.addEventListener("worktop:launch-close", onLaunchClose);
    window.addEventListener("worktop:launch-create", onLaunchCreate);
    window.addEventListener("worktop:launch-open", onLaunchOpen);
    window.addEventListener("worktop:launch-app", onLaunchApp);
    return () => {
      window.removeEventListener("worktop:new-tab", onNewTab);
      window.removeEventListener("worktop:new-chat", onNewChat);
      window.removeEventListener("worktop:chat-created", onChatCreated);
      window.removeEventListener("worktop:launch", onLaunch);
      window.removeEventListener("worktop:launch-close", onLaunchClose);
      window.removeEventListener("worktop:launch-create", onLaunchCreate);
      window.removeEventListener("worktop:launch-open", onLaunchOpen);
      window.removeEventListener("worktop:launch-app", onLaunchApp);
    };
  });

  const commands: Command[] = [
    { id: "new-agent", label: "新建对话", icon: <Bot size={14} />, run: () => createAtCurrentTarget("chat") },
    { id: "open-url", label: "打开网址…", icon: <Globe size={14} />, run: async () => {
      const raw = await dialog.prompt("", { title: "打开网址", placeholder: "example.com", confirmText: "打开" });
      if (raw && raw.trim()) openWebTab(/^[a-z][a-z0-9+.-]*:/i.test(raw.trim()) ? raw.trim() : `https://${raw.trim()}`);
    } },
    { id: "new-folder", label: "新建文件夹", icon: <Folder size={14} />, run: () => createAtCurrentTarget("folder") },
    { id: "new-file", label: "新建文件", icon: <FileText size={14} />, run: () => createAtCurrentTarget("file") },
    { id: "add-root", label: "添加文件夹", icon: <FolderPlus size={14} />, run: addRoot },
    { id: "quick-open", label: "快速打开…", hint: "⌘P", icon: <Search size={14} />, run: () => setQuickOpen(true) },
    {
      id: "move-tab-side",
      label: "移动当前标签到另一侧",
      icon: <PanelRight size={14} />,
      run: () => {
        const id = tabGroups.activeGroup.activeId;
        if (id) tabGroups.moveTab(tabGroups.activeGroupId, id);
      },
    },
    { id: "settings", label: "打开设置", icon: <SettingsIcon size={14} />, run: openSettings },
    { id: "widgets", label: "管理组件", icon: <LayoutGrid size={14} />, run: openWidgets },
    {
      id: "close-tab",
      label: "关闭当前标签",
      icon: <X size={14} />,
      run: () => {
        const id = tabGroups.activeGroup.activeId;
        if (id) tabGroups.closeTab(tabGroups.activeGroupId, id);
      },
    },
    { id: "close-all", label: "关闭所有标签", icon: <X size={14} />, run: () => tabGroups.closeAll() },
  ];

  // 标签操作包:装一次,贯穿 Layout → Group → TabBar(不再逐层点名回调)
  const tabActions: TabActions = {
    focusGroup: tabGroups.focusGroup,
    activate: (groupId, tabId) => {
      tabGroups.activateTab(groupId, tabId);
      tabGroups.updateChatTab(tabId, { unread: false }); // 点开即已读
    },
    close: tabGroups.closeTab,
    reorder: tabGroups.reorderTabs,
    moveFromGroup: tabGroups.moveTab,
    moveToOther: tabGroups.moveTab,
    toggleSideGroup: tabGroups.toggleSideGroup,
    closeOthers: tabGroups.closeOthers,
    closeToRight: tabGroups.closeToRight,
    closeGroup: tabGroups.closeGroup,
    newTab: (groupId) => tabGroups.openLauncher({ groupId }),
  };

  const toggleNav = () => {
    if (window.matchMedia("(min-width: 768px)").matches) {
      setDesktopNavOpen((open) => !open);
      return;
    }
    setMobileNavOpen(true);
  };
  const closeNav = () => setMobileNavOpen(false);

  return (
    <div className="h-screen flex overflow-hidden bg-bg text-text font-sans relative">
      <PanelHost
        selectedId={selectedNode?.id || activeNode?.id || ""}
        onSelect={openNode}
        socket={socket}
        onOpenUrl={openWebTab}
        onOpenApp={openApp}
        onOpenTask={(taskId, title) => tabGroups.openTask(taskId, title)}
        onToggleNav={toggleNav}
        onSetDesktopOpen={setDesktopNavOpen}
        onOpenSide={(n) => openNode(n, { groupId: "side" })}
        onOpenTerminal={openTerminal}
        onOpenGit={openGit}
        refreshKey={treeRefresh}
        settingsActive={isSettingsTab(tabGroups.activeTab)}
        onOpenSettings={openSettings}
        mobileOpen={mobileNavOpen}
        desktopOpen={desktopNavOpen}
        onCloseMobile={closeNav}
        onChanged={() => {
          setTreeRefresh((n) => n + 1);
          refreshGit();
        }}
      />

      {quickOpen && <QuickOpen onPick={(n) => openNode(n)} onClose={() => setQuickOpen(false)} />}
      {cmdOpen && <CommandPalette commands={commands} onClose={() => setCmdOpen(false)} />}
      <DialogHost />{/* 全局对话框:提示/确认/输入,全产品一套 */}
      <BrowsingPrompts />{/* 网页的权限 / HTTP 认证 / 证书问询 —— session 级,挂一份 */}
      <SystemNotices />{/* 右下角系统气泡:更新就绪 + 官方公告 */}
      <ToastHost />{/* 轻提示(应用 ui.toast 也走这里) */}

      {/* 移动端遮罩 */}
      {mobileNavOpen && (
        <div className="md:hidden absolute inset-0 bg-black/30 z-30 transition-opacity" onClick={closeNav} />
      )}

      <div className="flex-1 flex min-w-0 min-h-0">
        <WorkspaceLayout
          groups={tabGroups.visibleGroups}
          allGroups={tabGroups.allGroups}
          activeGroupId={tabGroups.activeGroupId}
          sideOpen={tabGroups.sideOpen}
          navOpen={desktopNavOpen}
          onOpenNav={toggleNav}
          dirtyIds={dirtyIds}
          tabs={tabActions}
          content={{
            socket,
            drafts,
            fileRefreshKeys,
            gitRefreshKey,
            onFileChange,
            onFileSaved,
            onSelect: openNode,
            onOpenSkill: tabGroups.openSkill,
            onOpenSettings: openSettings,
            onGitChanged: refreshGit,
            onOpenGitDiff: (root, path, staged, commit) => tabGroups.openGitDiff(root, path, staged, { commit }),
          }}
          onUpdateWebTab={tabGroups.updateWebTab}
        />
      </div>
    </div>
  );
}

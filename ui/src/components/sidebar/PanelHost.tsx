import { type GitRepositoryStatus } from "../../api/git";
import { type Chat, chatsApi } from "../../api/chats";
import { type FileNode } from "../../api/files";
import { widgetsApi } from "../../api/widgets";
import { appsApi } from "../../api/apps";
// 面板宿主:侧边栏的「壳」= 最左侧竖排活动栏 + 内容面板。
//
// 活动栏仿 VS Code:贯穿整个窗口高度,分两段 ——
//   原生(会话/文件/网站/应用,焊死)钉顶 → 小组件/任务/设置钉底。
// 小组件与任务不是主角:点开占侧栏下半(上半的面板还在),再点一次关掉;
// 组件不再陈列在活动栏上:全部收进「小组件」(格子;点一个进入,‹ 返回)。
// 状态点(会话未读/运行、应用在跑)上浮到图标上,面板关着也看得见。
// 「收起侧栏」只收内容面板,活动栏常驻;点当前图标一下 = 收起(VS Code 的肌肉记忆)。
// 组件的身体是 iframe,指向组件自己的 origin;契约是出厂技能 skills/widget。
import { useEffect, useRef, useState } from "react";
import { ContextMenu, Favicon, dialog, type MenuItem } from "../ui";
import { isPinned, togglePin, unpin, useRailPins, type RailPin } from "../../lib/railPins";
import { Activity, ChevronLeft, PanelLeft, Pin, PinOff, Plus, Puzzle, Settings, Trash2, X } from "lucide-react";
import { beginGlobalDrag, endGlobalDrag } from "../../lib/drag";
import { CREATE_WIDGET_EVENT, applyOrder, dropFromOrder, useWidgetOrder, writeOrder } from "../../lib/widgetOrder";
import { EVENTS } from "../../../../server/shared/events";
import { NATIVE_PANELS, type WidgetDef } from "./registry";
import { ChatRail } from "./panels/ChatRail";
import { FilesPanel } from "./panels/FilesPanel";
import { SitesPanel } from "./panels/SitesPanel";
import { AppsPanel } from "./panels/AppsPanel";
import { TasksPanel } from "./panels/TasksPanel";
import { WidgetFrame } from "../widgets/WidgetFrame";

type Socket = { send: (m: any) => void; on: (t: string, fn: (p: any) => void) => () => void };

const TOOL_WIDGET_KEY = "worktop.tools.widget";
const LOWER_KEY = "worktop.lower";
const LOWER_RATIO_KEY = "worktop.lower.ratio";
const clampRatio = (r: number) => Math.max(0.2, Math.min(0.8, r));
type LowerId = "tools" | "tasks";

/** 「让 AI 造一个组件」的开工指令:自包含的契约速查表(全写进提示词,不指望 AI 去翻文档)。 */
const buildWidgetPrompt = (desc: string) => `请为我造一个组件:${desc.trim()}

按「技能」里的 widget 做。写完告诉我组件名,它会出现在侧栏的「小组件」面板里。`;

/** 「让 AI 造一个应用」的开工指令:自包含的契约速查表(见 AGENT 仓库 SPEC.md)。 */
const buildAppPrompt = (desc: string) => `请为我造一个应用:${desc.trim()}

应用 = 应用的家里的一个目录,**一个有自己 origin 的本地网站**。
宿主把它跑起来、摆进「应用」面板、介绍给 AI:

<应用的家>/apps/<id>/
  manifest.json   声明:是什么、怎么跑、要什么
  APP.md          文档:API 表 / 什么时候用 / 数据 —— 给模型读
  icon.svg        可选
  (实现)          随便什么语言、框架、构建方式,契约不管

应用的家是 ~/.worktop/apps/(不是工作目录,不是工作区)。

manifest.json:
{ "id": "notes", "name": "便签", "version": "0.1.0",
  "description": "一句话说清是什么、什么时候用 —— 这行会常驻 AI 的提示词",
  "run": { "command": "node", "args": ["server.js"], "health": "/health", "mode": "on-demand" },
  "permissions": ["ai.complete"] }     ← ai.complete / ai.agent / notify,不写就没有

生命周期,这几条必须守:
1. **监听 process.env.PORT,绑定 process.env.HOST**(别写死 127.0.0.1 ——
   绑哪个地址是宿主决定的);
2. **整站自己应答**:页面、静态资源、API 全从这个端口出,GUI 在 / 上;
3. **health 是三态的**:2xx = 就绪;其它 HTTP 应答(如 503)= 活着但还在初始化,
   宿主会继续等;连不上 = 没起来。启动慢就先答 503,起好了再答 200;
4. 数据写 process.env.APP_DATA_DIR(宿主已建好),别写进 app 目录;
5. on-demand 的应用闲置会被回收。**浏览器直连你的 origin,那些流量宿主看不见** ——
   有长任务就在 health 里应答 {"busy": true},或者把状态落盘、随时可恢复;
6. run.args 原样传给进程,不经 shell、不做变量展开 —— 要用 PORT 就在程序里读环境变量。

宿主能力(要用才声明,带 Authorization: Bearer \${process.env.APP_TOKEN}):
  GET  \${process.env.HOST_URL}/apps/me            → { appId, name, version, permissions }
  POST \${process.env.HOST_URL}/apps/ai/complete   { prompt, instructions? } → { text }
  POST \${process.env.HOST_URL}/apps/ai/agent      { prompt, title?, cwd? } → SSE 任务事件流
  POST \${process.env.HOST_URL}/apps/notify        { text, kind?: "toast"|"badge" }
这里的 /apps/* 是宿主提供给应用的接口;主界面的 /api/apps 是应用管理接口。
文件、网络、进程你本来就有,不需要宿主转手。

**人机协同是重点:状态只有一份真相,在你的 server 侧。**
人在界面上改、AI 调你的 API 改,改的是同一份状态;而且经 API 发生的变更
必须反映到正在看的界面上(SSE / WebSocket / 轮询都行)——
否则 AI 改了内容而用户在屏幕上看不见,协同就是背对背各改各的。

最后写 APP.md:API 表(方法/路径/参数/返回,AI 照着 curl 你)、什么时候用、
数据结构、以及不可逆的端点必须写明「此操作不可逆」。

写完告诉我应用名,以及怎么在「应用」面板里打开它。`;

export function PanelHost({
  selectedId,
  onSelect,
  socket,
  onOpenUrl,
  onOpenApp,
  onOpenTask,
  onToggleNav,
  onSetDesktopOpen,
  onOpenSide,
  onOpenTerminal,
  onOpenGit,
  refreshKey,
  settingsActive,
  onOpenSettings,
  mobileOpen = false,
  desktopOpen = true,
  onCloseMobile,
  onChanged,
}: {
  selectedId: string;
  onSelect: (n: (Chat | FileNode) | null) => void;
  socket: Socket;
  onOpenUrl: (url: string, title?: string) => void;
  /** 打开一个应用(开在标签页 —— 组件挂侧栏,应用上标签)。 */
  onOpenApp: (appId: string, name: string) => void;
  /** 打开一条任务的详情标签。 */
  onOpenTask: (taskId: string, title: string) => void;
  onToggleNav?: () => void;
  /** 直接设定内容面板开合(点当前图标收起、点别的图标展开都要一个确定态,toggle 不够)。 */
  onSetDesktopOpen?: (open: boolean) => void;
  onOpenSide?: (n: (Chat | FileNode)) => void;
  onOpenTerminal?: (n: FileNode, opts?: { command?: string; titlePrefix?: string }) => void;
  onOpenGit?: (repo: GitRepositoryStatus) => void;
  refreshKey: number;
  settingsActive: boolean;
  onOpenSettings: () => void;
  /** 打开「组件」管理标签页(管理是摊开来看的事,不塞侧栏)。 */
  mobileOpen?: boolean;
  desktopOpen?: boolean;
  onCloseMobile?: () => void;
  onChanged?: () => void;
}) {
  // ── 组件:全部来自组件的家(<家>/widgets/<id>/),目录即安装 ──
  const order = useWidgetOrder();
  const [widgets, setWidgets] = useState<WidgetDef[]>([]);
  const reloadWidgets = () => widgetsApi.listWidgets()
    .then((list) => setWidgets(list as WidgetDef[]))
    .catch(() => {});
  useEffect(() => { void reloadWidgets(); }, [refreshKey]);
  // 装了就进「小组件」面板,没有钉选;顺序 = 用户拖出来的顺序,新装的垫后
  const tiles = applyOrder(widgets);
  void order; // 订阅它只为拖拽后重排

  // 小组件面板里当前进入的组件(null = 看格子);记住,下次打开还在
  const [toolWidgetId, setToolWidgetId] = useState<string | null>(() => localStorage.getItem(TOOL_WIDGET_KEY));
  const enterWidget = (id: string | null) => {
    setToolWidgetId(id);
    if (id) localStorage.setItem(TOOL_WIDGET_KEY, id); else localStorage.removeItem(TOOL_WIDGET_KEY);
  };

  const [sideTab, setSideTab] = useState<string>(() => localStorage.getItem("worktop.sideTab") || "agents");
  // 小组件面板格子的拖拽排序:dragId = 手里拿着谁;dropAt = 松手会插到谁前面(null = 段尾)
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropAt, setDropAt] = useState<string | null | undefined>(undefined);
  const reorder = (id: string, beforeId: string | null) => {
    const ids = tiles.map((w) => w.id).filter((x) => x !== id);
    const at = beforeId == null ? ids.length : ids.indexOf(beforeId);
    ids.splice(at < 0 ? ids.length : at, 0, id);
    writeOrder(ids);
  };
  const nativeIds = NATIVE_PANELS.map((p) => p.id as string);
  const activePanelId = nativeIds.includes(sideTab) ? sideTab : "agents";
  const switchTab = (tab: string) => {
    setSideTab(tab);
    localStorage.setItem("worktop.sideTab", tab);
  };

  // 活动栏点击:点当前图标 = 收起面板;点别的 = 切换并展开(VS Code 的肌肉记忆)
  const onRailClick = (id: string) => {
    const desktop = window.matchMedia("(min-width: 768px)").matches;
    if (desktop && activePanelId === id && desktopOpen) { onSetDesktopOpen?.(false); return; }
    switchTab(id);
    if (desktop && !desktopOpen) onSetDesktopOpen?.(true);
  };

  // 下半:小组件 / 任务不是主角,不抢上半的面板 —— 打开后占侧栏下半,再点一次关掉
  const [lower, setLower] = useState<LowerId | null>(() => {
    const v = localStorage.getItem(LOWER_KEY);
    return v === "tools" || v === "tasks" ? v : null;
  });
  const openLower = (id: LowerId | null) => {
    setLower(id);
    if (id) localStorage.setItem(LOWER_KEY, id); else localStorage.removeItem(LOWER_KEY);
  };
  // 下半占侧栏的比例:拖中间那条线调,20%–80%,记住
  const [lowerRatio, setLowerRatio] = useState(() => {
    const v = Number(localStorage.getItem(LOWER_RATIO_KEY));
    return Number.isFinite(v) && v > 0 ? clampRatio(v) : 0.5;
  });
  const columnRef = useRef<HTMLDivElement>(null);
  const startLowerResize = (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const total = columnRef.current?.getBoundingClientRect().height || 0;
    if (!total) return;
    const startY = e.clientY;
    const startRatio = lowerRatio;
    let current = startRatio;
    const previousCursor = document.body.style.cursor;
    const previousSelect = document.body.style.userSelect;
    document.body.style.cursor = "row-resize";
    document.body.style.userSelect = "none";
    beginGlobalDrag();
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousSelect;
      endGlobalDrag();
      localStorage.setItem(LOWER_RATIO_KEY, current.toFixed(3));
    };
    const onMove = (ev: PointerEvent) => {
      if (ev.buttons === 0) { onUp(); return; }
      current = clampRatio(startRatio - (ev.clientY - startY) / total);
      setLowerRatio(current);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };
  const toggleLower = (id: LowerId) => {
    const desktop = window.matchMedia("(min-width: 768px)").matches;
    if (desktop && !desktopOpen) { onSetDesktopOpen?.(true); openLower(id); return; }
    openLower(lower === id ? null : id);
  };

  // ── 图标上的状态点:面板关着也看得见 ──
  // 会话:运行中亮蓝点,只有未读亮绿点(与列表里的点同一套语义)
  const [chatBadge, setChatBadge] = useState<"" | "run" | "unread">("");
  useEffect(() => {
    let gone = false;
    const load = () => {
      void Promise.all([chatsApi.listChats().catch(() => null), chatsApi.listRuns().catch(() => null)])
        .then(([chats, runs]) => {
          if (gone) return;
          const running = !!(runs?.ids || []).length;
          const unread = !!chats?.chats.some((c) => c.unread);
          setChatBadge(running ? "run" : unread ? "unread" : "");
        });
    };
    load();
    // refreshKey 不含 START(App 只在终局事件上节流刷新),运行点要即时亮,这里自己订阅
    const offs = [EVENTS.RUN_START, EVENTS.RUN_DONE, EVENTS.RUN_ABORTED, EVENTS.RUN_ERROR, EVENTS.INPUT, "chats_changed"]
      .map((t) => socket.on(t, load));
    return () => { gone = true; offs.forEach((off) => off()); };
  }, [socket, refreshKey]);
  // 应用:有一个在跑就亮蓝点
  const [appsRunning, setAppsRunning] = useState(false);
  useEffect(() => {
    const load = () => void appsApi.listApps()
      .then((list) => setAppsRunning(list.some((a) => a.status === "ready" || a.status === "starting")))
      .catch(() => {});
    load();
    return socket.on("app_status", load);
  }, [socket]);
  const nativeBadge = (id: string): "" | "run" | "unread" => {
    if (id === "agents") return chatBadge;
    if (id === "apps") return appsRunning ? "run" : "";
    return "";
  };

  const removeWidget = async (widget: WidgetDef) => {
    const ok = await dialog.confirm(
      `删除组件「${widget.name}」?\n目录 widgets/${widget.id}/(含数据 data.db)会移进回收站,30 天后清除。`,
      { danger: true, confirmText: "删除" },
    );
    if (!ok) return;
    try { await widgetsApi.removeWidget(widget.id); } catch (e: any) { void dialog.alert(e?.message || "删除失败"); return; }
    void reloadWidgets();
    dropFromOrder(widget.id);
    unpin("widget", widget.id);
    if (toolWidgetId === widget.id) enterWidget(null);
  };

  // 让 AI 造一个组件:一句话 → 新对话 → agent 在 widgets/ 里写出目录 → 自动出现在「小组件」面板
  const createWidgetWithAI = async () => {
    const desc = await dialog.prompt("", {
      title: "让 AI 造一个组件",
      placeholder: "描述你要的组件,如:喝水打卡,记录每天几杯",
      confirmText: "开工",
    });
    if (!desc || !desc.trim()) return;
    try {
      const r = await chatsApi.createChat({ title: "" });
      onSelect(r.item);
      socket.send({ type: "send", chatId: r.item.id, prompt: buildWidgetPrompt(desc) });
      switchTab("agents");
    } catch (e: any) {
      void dialog.alert(e?.message || "创建失败");
    }
  };

  // 组件管理页(标签页)里点「让 AI 造一个」—— 动作住在这儿(要开对话、发提示词)
  useEffect(() => {
    const onCreate = () => { void createWidgetWithAI(); };
    window.addEventListener(CREATE_WIDGET_EVENT, onCreate);
    return () => window.removeEventListener(CREATE_WIDGET_EVENT, onCreate);
  });

  // ── 宽度拖拽(只管内容面板;活动栏定宽)──
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const saved = Number(localStorage.getItem("worktop.sidebarWidth") || "");
    return Number.isFinite(saved) && saved >= 220 && saved <= 420 ? saved : 260;
  });
  const startResize = (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startWidth = sidebarWidth;
    const previousCursor = document.body.style.cursor;
    const previousSelect = document.body.style.userSelect;
    let currentWidth = startWidth;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    beginGlobalDrag();
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousSelect;
      endGlobalDrag();
      localStorage.setItem("worktop.sidebarWidth", String(Math.round(currentWidth)));
    };
    const onMove = (ev: PointerEvent) => {
      if (ev.buttons === 0) { onUp(); return; }
      const next = Math.max(220, Math.min(420, startWidth + ev.clientX - startX));
      currentWidth = next;
      setSidebarWidth(next);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  // 让 AI 造一个应用:与造组件同一条路,只是给的契约不同
  const createAppWithAI = async () => {
    const desc = await dialog.prompt("", {
      title: "让 AI 创建应用",
      placeholder: "描述应用功能,例如:看板,任务可拖动改变状态",
      confirmText: "开工",
    });
    if (!desc || !desc.trim()) return;
    try {
      const r = await chatsApi.createChat({ title: "" });
      onSelect(r.item);
      socket.send({ type: "send", chatId: r.item.id, prompt: buildAppPrompt(desc) });
      switchTab("agents");
    } catch (e: any) {
      void dialog.alert(e?.message || "创建失败");
    }
  };

  // ── 右键菜单(小组件面板的格子):删除 ──
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);
  const onWidgetContext = (e: React.MouseEvent, widget: WidgetDef) => {
    e.preventDefault();
    const pinned = isPinned("widget", widget.id);
    setMenu({
      x: e.clientX, y: e.clientY,
      items: [
        { label: pinned ? "从活动栏取消固定" : "固定到活动栏", icon: pinned ? <PinOff size={13} /> : <Pin size={13} />,
          onClick: () => { togglePin({ kind: "widget", id: widget.id, title: widget.name, icon: widget.icon }); } },
        "divider",
        { label: `删除组件「${widget.name}」`, icon: <Trash2 size={13} />, danger: true, onClick: () => void removeWidget(widget) },
      ],
    });
  };

  // ── 活动栏上固定的应用 / 网站 / 小组件 ──
  const pins = useRailPins();
  const openPin = (p: RailPin) => {
    if (p.kind === "app") onOpenApp(p.id, p.title);
    else if (p.kind === "site" && p.url) onOpenUrl(p.url, p.title);
    else if (p.kind === "widget") {
      const desktop = window.matchMedia("(min-width: 768px)").matches;
      if (desktop && !desktopOpen) onSetDesktopOpen?.(true);
      openLower("tools"); enterWidget(p.id);
    }
    if (mobileOpen) onCloseMobile?.();
  };
  const onPinContext = (e: React.MouseEvent, p: RailPin) => {
    e.preventDefault();
    setMenu({
      x: e.clientX, y: e.clientY,
      items: [{ label: "从活动栏取消固定", icon: <PinOff size={13} />, onClick: () => unpin(p.kind, p.id) }],
    });
  };
  const pinIcon = (p: RailPin) => {
    if (p.kind === "site" && p.url) return <Favicon url={p.url} size={16} />;
    if (p.kind === "widget") return <span className="text-[16px] leading-none">{p.icon}</span>;
    return p.hasIcon
      ? <img src={`/api/apps/icon?id=${encodeURIComponent(p.id)}`} alt="" className="w-[18px] h-[18px] rounded" />
      : <span className="w-[18px] h-[18px] rounded bg-bg-inset flex items-center justify-center text-[11px]">{Array.from(p.title)[0]}</span>;
  };

  // 移动端抽屉:选中即收(文件夹除外)
  const handleSelect = (n: (Chat | FileNode) | null) => {
    onSelect(n);
    if (mobileOpen && n?.kind !== "folder") onCloseMobile?.();
  };
  const handleToggleSettings = () => {
    onOpenSettings();
    if (mobileOpen) onCloseMobile?.();
  };

  const toolWidget = lower === "tools" ? tiles.find((w) => w.id === toolWidgetId) || null : null;
  const activeNative = NATIVE_PANELS.find((p) => p.id === activePanelId) || null;

  return (
    <aside
      className={[
        "flex border-r border-border bg-bg-raised shrink-0",
        "absolute inset-y-0 left-0 z-40 shadow-2xl shadow-black/10",
        "md:relative md:shadow-none",
        mobileOpen ? "flex" : "hidden",
        "md:flex", // 桌面端活动栏常驻 —— 收起收的是内容面板,不是它
      ].join(" ")}
    >
      {/* ── 活动栏:52px 竖排,三段:原生钉顶 → 固定的应用/网站/小组件(有才出现,带分割线,可滚)→ 小组件/任务/设置钉底 ── */}
      <div className="w-[52px] shrink-0 flex flex-col items-center py-1">
        <div className="shrink-0 w-full flex flex-col items-center gap-0.5">
          {NATIVE_PANELS.map((p) => (
            <RailButton
              key={p.id}
              title={p.title}
              active={activePanelId === p.id && !settingsActive}
              badge={nativeBadge(p.id)}
              onClick={() => onRailClick(p.id)}
            >
              <p.icon size={18} />
            </RailButton>
          ))}
        </div>
        {pins.length > 0 && <div className="shrink-0 w-7 h-px bg-border my-1.5" />}
        <div className="flex-1 min-h-0 w-full overflow-y-auto no-scrollbar flex flex-col items-center gap-0.5">
          {pins.map((p) => (
            <RailButton
              key={`${p.kind}:${p.id}`}
              title={`${p.title}(${p.kind === "app" ? "应用" : p.kind === "site" ? "网站" : "小组件"},右键取消固定)`}
              active={p.kind === "widget" && lower === "tools" && toolWidgetId === p.id && desktopOpen}
              onClick={() => openPin(p)}
              onContextMenu={(e) => onPinContext(e, p)}
            >
              {pinIcon(p)}
            </RailButton>
          ))}
        </div>
        <div className="shrink-0 w-full flex flex-col items-center gap-0.5 pt-1">
          <div className="w-7 h-px bg-border mb-1" />
          <RailButton title="小组件(占侧栏下半)" active={lower === "tools" && desktopOpen} onClick={() => toggleLower("tools")}>
            <Puzzle size={18} />
          </RailButton>
          <RailButton title="任务:应用在后台替你干的活(占侧栏下半)" active={lower === "tasks" && desktopOpen} onClick={() => toggleLower("tasks")}>
            <Activity size={18} />
          </RailButton>
          <RailButton title="设置" active={settingsActive} onClick={handleToggleSettings}>
            <Settings size={18} />
          </RailButton>
        </div>
      </div>

      {/* ── 内容面板:桌面端可收起(活动栏留着),移动端跟抽屉走 ── */}
      <div
        ref={columnRef}
        style={{ width: `min(${sidebarWidth}px, calc(100vw - 84px))` }}
        className={[
          "relative flex flex-col min-w-0 border-l border-border",
          desktopOpen ? "" : "md:hidden",
        ].join(" ")}
      >
        {/* 面板头:一行搞定 —— 当前面板叫什么 + 右侧收起(移动端 X 关抽屉),没有品牌行 */}
        {/* 高度与标签栏对齐(两边各让一半:40 / 44 → 42) */}
        {/* ── 上半:当前原生面板;下半开着时按 lowerRatio 分高 ── */}
        <div style={{ flex: `${lower ? 1 - lowerRatio : 1} 1 0px` }} className="min-h-0 flex flex-col">
        <div className="shrink-0 h-[42px] flex items-center gap-2 px-3.5 border-b border-border">
          {activeNative && <activeNative.icon size={14} className="text-accent shrink-0" />}
          <span className="text-[13px] font-medium text-text truncate flex-1">{activeNative?.title}</span>
          {onToggleNav && (
            <button
              onClick={onToggleNav}
              title="收起侧栏面板(活动栏不会消失)"
              className="hidden md:flex w-6 h-6 rounded items-center justify-center text-text-faint hover:text-text hover:bg-bg-hover transition-colors"
            >
              <PanelLeft size={16} />
            </button>
          )}
          {onCloseMobile && (
            <button
              onClick={onCloseMobile}
              className="md:hidden w-6 h-6 rounded flex items-center justify-center text-text-faint hover:text-text hover:bg-bg-hover transition-colors"
            >
              <X size={14} />
            </button>
          )}
        </div>

        {/* ── 面板身体:会话切走即卸;文件常驻隐藏保重状态;组件 = iframe 沙箱 ── */}
        {activePanelId === "agents" && (
          <ChatRail
            selectedId={selectedId}
            onSelect={handleSelect}
            refreshKey={refreshKey}
            socket={socket}
          />
        )}
        <FilesPanel
          active={activePanelId === "files"}
          selectedId={selectedId}
          onSelect={handleSelect}
          onOpenSide={onOpenSide}
          onOpenTerminal={onOpenTerminal}
          onOpenGit={onOpenGit}
          refreshKey={refreshKey}
          onChanged={onChanged}
        />
        {activePanelId === "sites" && <SitesPanel onOpenUrl={onOpenUrl} socket={socket} />}
        {activePanelId === "apps" && (
          <AppsPanel socket={socket} onOpenApp={(app) => onOpenApp(app.id, app.name)} onCreate={createAppWithAI} />
        )}
        </div>

        {/* ── 下半:小组件 / 任务;顶上那条线可拖,改上下分高;头一行 = (‹ 返回)图标 + 名字 + ✕ ── */}
        {lower && (
          <div style={{ flex: `${lowerRatio} 1 0px` }} className="min-h-0 flex flex-col">
            <div className="relative shrink-0 h-px bg-border">
              <div
                onPointerDown={startLowerResize}
                className="absolute inset-x-0 -top-[3px] h-[7px] z-10 cursor-row-resize hover:bg-accent/25"
                title="调整上下高度"
              />
            </div>
            <div className="shrink-0 h-[34px] flex items-center gap-2 px-3.5">
              {toolWidget && (
                <button
                  onClick={() => enterWidget(null)}
                  title="返回小组件"
                  className="-ml-1.5 w-6 h-6 rounded flex items-center justify-center text-text-faint hover:text-text hover:bg-bg-hover transition-colors"
                >
                  <ChevronLeft size={15} />
                </button>
              )}
              {toolWidget
                ? <span className="text-[14px] leading-none">{toolWidget.icon}</span>
                : lower === "tools"
                  ? <Puzzle size={14} className="text-accent shrink-0" />
                  : <Activity size={14} className="text-accent shrink-0" />}
              <span className="text-[13px] font-medium text-text truncate flex-1">
                {toolWidget ? toolWidget.name : lower === "tools" ? "小组件" : "任务"}
              </span>
              <button
                onClick={() => openLower(null)}
                title="关闭"
                className="w-6 h-6 rounded flex items-center justify-center text-text-faint hover:text-text hover:bg-bg-hover transition-colors"
              >
                <X size={14} />
              </button>
            </div>
            {lower === "tasks" && <TasksPanel socket={socket} onOpenTask={onOpenTask} />}
            {lower === "tools" && (toolWidget ? (
              <WidgetFrame key={toolWidget.id} widget={toolWidget} />
            ) : (
              <div
                className="flex-1 min-h-0 overflow-y-auto p-2"
                onDragOver={(e) => { if (dragId) { e.preventDefault(); setDropAt(null); } }}
                onDrop={(e) => { if (dragId) { e.preventDefault(); reorder(dragId, null); } }}
              >
                <div className="grid grid-cols-4 gap-1">
                  {tiles.map((w) => (
                    <button
                      key={w.id}
                      draggable
                      onDragStart={(e) => {
                        e.dataTransfer.effectAllowed = "move";
                        setDragId(w.id);
                        beginGlobalDrag();
                      }}
                      onDragEnd={() => { setDragId(null); setDropAt(undefined); endGlobalDrag(); }}
                      onDragOver={(e) => {
                        if (!dragId || dragId === w.id) return;
                        e.preventDefault();
                        e.stopPropagation();
                        setDropAt(w.id);
                      }}
                      onDrop={(e) => {
                        if (!dragId || dragId === w.id) return;
                        e.preventDefault();
                        e.stopPropagation();
                        reorder(dragId, w.id);
                      }}
                      onClick={() => enterWidget(w.id)}
                      onContextMenu={(e) => onWidgetContext(e, w)}
                      title={`${w.name}${w.description ? `\n${w.description}` : ""}\n(可拖动排序,右键删除)`}
                      className={[
                        "relative flex flex-col items-center gap-1 px-1 py-2.5 rounded-lg text-[11.5px] text-text-dim hover:bg-bg-hover transition-colors",
                        dragId === w.id ? "opacity-40" : "",
                        // 插入指示线:落点左侧一条 accent 短线
                        dropAt === w.id ? "before:content-[''] before:absolute before:-left-[3px] before:top-1 before:bottom-1 before:w-[2px] before:rounded before:bg-accent" : "",
                      ].join(" ")}
                    >
                      <span className="text-[22px] leading-none">{w.icon}</span>
                      <span className="max-w-full truncate">{w.name}</span>
                    </button>
                  ))}
                  <button
                    onClick={() => void createWidgetWithAI()}
                    title="让 AI 造一个组件"
                    className="flex flex-col items-center gap-1 px-1 py-2.5 rounded-lg text-[11.5px] text-text-faint hover:text-text hover:bg-bg-hover transition-colors"
                  >
                    <span className="w-[22px] h-[22px] flex items-center justify-center"><Plus size={18} /></span>
                    <span>造一个</span>
                  </button>
                </div>
                {!tiles.length && (
                  <div className="px-3 py-6 text-center text-[12px] text-text-faint leading-relaxed">还没有小组件。点「造一个」让 AI 写。</div>
                )}
              </div>
            ))}
          </div>
        )}

        <div
          onPointerDown={startResize}
          className="hidden md:block absolute top-0 right-[-3px] z-20 h-full w-1.5 cursor-col-resize hover:bg-accent/25"
          title="调整侧边栏宽度"
        />
      </div>

      {menu && <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />}
    </aside>
  );
}

/** 活动栏按钮:44×40,选中 = 软底色 + 左缘指示条;状态点压在图标右上角。 */
function RailButton({
  title,
  active,
  badge = "",
  onClick,
  onContextMenu,
  children,
}: {
  title: string;
  active: boolean;
  badge?: "" | "run" | "unread";
  onClick: (e: React.MouseEvent) => void;
  onContextMenu?: (e: React.MouseEvent) => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      onContextMenu={onContextMenu}
      title={title}
      className={[
        "relative w-11 h-10 shrink-0 rounded-lg flex items-center justify-center transition-colors",
        active ? "bg-accent-soft text-accent" : "text-text-faint hover:text-text-dim hover:bg-bg-hover",
      ].join(" ")}
    >
      {children}
      {badge && (
        <span className={[
          "absolute top-1.5 right-2 w-[7px] h-[7px] rounded-full border-2 border-bg-raised",
          badge === "run" ? "bg-accent" : "bg-success",
        ].join(" ")} />
      )}
      {active && <span className="absolute -left-1 top-2 bottom-2 w-[3px] rounded-r bg-accent" />}
    </button>
  );
}

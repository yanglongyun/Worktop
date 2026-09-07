import { useEffect, useRef, useState } from "react";
import { fileIconFor, fileColorFor } from "../files/icons";
import { Bot, X, Activity, FileText, AppWindow, LayoutGrid, Circle, Columns2, GitBranch, GitCompare, Globe, PanelLeft, PanelRight, Plus, Settings, Terminal } from "lucide-react";
import { ContextMenu, Favicon, type MenuItem } from "../ui";
import { beginGlobalDrag, endGlobalDrag } from "../../lib/drag";
import type { TabActions, WorkspaceGroupId, WorkspaceTab } from "./types";

const tabIconFor = (tab: WorkspaceTab) =>
  tab.kind === "git-diff" ? GitCompare :
  tab.kind === "git" ? GitBranch :
  tab.kind === "settings" ? Settings :
  tab.kind === "widgets" ? LayoutGrid :
  tab.kind === "terminal" ? Terminal :
  tab.kind === "app" ? AppWindow :
  tab.kind === "web" ? Globe :
  tab.kind === "task" ? Activity :
  tab.kind === "skill" ? FileText :
  tab.kind === "launcher" || tab.kind === "chat-start" ? Plus : tab.kind === "chat" ? Bot : fileIconFor(tab.kind, tab.title);

const tabColorFor = (tab: WorkspaceTab) =>
  tab.kind === "git-diff" ? "text-accent" :
  tab.kind === "git" ? "text-accent" :
  tab.kind === "settings" ? "text-text-dim" :
  tab.kind === "widgets" ? "text-accent" :
  tab.kind === "terminal" ? "text-success" :
  tab.kind === "app" ? "text-accent" :
  tab.kind === "web" ? "text-accent" :
  tab.kind === "task" ? "text-accent" :
  tab.kind === "skill" ? "text-text-dim" :
  tab.kind === "launcher" || tab.kind === "chat-start" ? "text-text-faint" : tab.kind === "chat" ? "text-warning" : fileColorFor(tab.kind);

type DropGuide = {
  marker: { x: number; y: number; height: number };
  zone: { x: number; y: number; width: number; height: number };
};

// 多标签栏:预览标签斜体、指针拖拽重排/跨组移动、滚轮横向滚动
export function TabBar({
  tabs,
  activeId,
  groupId,
  dirtyIds,
  previewId,
  actions,
  showSideToggle,
  sideToggleOpen,
  onOpenNav,
  navOpen,
}: {
  tabs: WorkspaceTab[];
  activeId: string | null;
  groupId: WorkspaceGroupId;
  dirtyIds: Set<string>;
  previewId: string | null;
  /** 全部标签操作:一个包,groupId 由本组补上。 */
  actions: TabActions;
  /** 是否显示右端的分屏开关(只有最右一组显示)。 */
  showSideToggle?: boolean;
  sideToggleOpen?: boolean;
  onOpenNav?: () => void;
  /** 侧边栏当前是否展开:展开时桌面端隐藏标签栏左端的汉堡(汉堡在侧栏头部)。 */
  navOpen?: boolean;
}) {
  const pointerDrag = useRef<{
    startX: number;
    startY: number;
    index: number;
    tabId: string;
    dragging: boolean;
    bodyCursor: string;
  } | null>(null);
  const suppressClick = useRef(false);
  const [overIdx, setOverIdx] = useState<number | null>(null);
  const [draggingTabId, setDraggingTabId] = useState<string | null>(null);
  const [dragPreview, setDragPreview] = useState<{ x: number; y: number; tab: WorkspaceTab } | null>(null);
  const [dropGuide, setDropGuide] = useState<DropGuide | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // 鼠标竖向滚轮 → 横向滚动标签;触控板横滑由 overflow-x-auto 原生处理
  const onWheel = (e: React.WheelEvent) => {
    const el = scrollRef.current;
    if (!el || el.scrollWidth <= el.clientWidth) return;
    if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
    el.scrollLeft += e.deltaY;
  };

  // 激活的标签滚进视野(新开的标签在末尾,溢出时不然会开在屏幕外)
  useEffect(() => {
    if (!activeId) return;
    scrollRef.current
      ?.querySelector<HTMLElement>(`[data-tab-id="${CSS.escape(activeId)}"]`)
      ?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [activeId, tabs.length]);

  const reorderWithinGroup = (fromIndex: number, toIndex: number) => {
    if (fromIndex === toIndex || fromIndex + 1 === toIndex) return;
    const next = [...tabs];
    const [moved] = next.splice(fromIndex, 1);
    const insertAt = toIndex > fromIndex ? toIndex - 1 : toIndex;
    next.splice(Math.max(0, Math.min(next.length, insertAt)), 0, moved);
    actions.reorder(groupId, next);
  };

  const dropGuideFor = (targetGroupId: WorkspaceGroupId, toIndex: number): DropGuide | null => {
    const groupEl = document.querySelector<HTMLElement>(`section[data-tab-drop-group="${targetGroupId}"]`);
    const tabBarEl = document.querySelector<HTMLElement>(`[data-tab-bar-group="${targetGroupId}"]`);
    if (!groupEl || !tabBarEl) return null;

    const zoneRect = groupEl.getBoundingClientRect();
    const barRect = tabBarEl.getBoundingClientRect();
    const tabEls = Array.from(tabBarEl.querySelectorAll<HTMLElement>("[data-tab-index]"));
    let markerX = barRect.left + 8;
    if (tabEls.length) {
      if (toIndex <= 0) {
        markerX = tabEls[0].getBoundingClientRect().left;
      } else if (toIndex >= tabEls.length) {
        markerX = tabEls[tabEls.length - 1].getBoundingClientRect().right;
      } else {
        markerX = tabEls[toIndex].getBoundingClientRect().left;
      }
    }
    return {
      marker: { x: markerX, y: barRect.top + 5, height: Math.max(24, barRect.height - 10) },
      zone: { x: zoneRect.left, y: zoneRect.top, width: zoneRect.width, height: zoneRect.height },
    };
  };

  const dropTargetAt = (x: number, y: number) => {
    const hit = document.elementFromPoint(x, y) as HTMLElement | null;
    const groupEl = hit?.closest<HTMLElement>("[data-tab-drop-group]");
    if (!groupEl) return null;
    const targetGroupId = groupEl.dataset.tabDropGroup as WorkspaceGroupId | undefined;
    if (targetGroupId !== "main" && targetGroupId !== "side") return null;

    const tabEl = hit?.closest<HTMLElement>("[data-tab-index]");
    let toIndex = Number(groupEl.dataset.tabCount || "0");
    if (tabEl && tabEl.closest("[data-tab-drop-group]") === groupEl) {
      const idx = Number(tabEl.dataset.tabIndex || "0");
      const rect = tabEl.getBoundingClientRect();
      toIndex = x > rect.left + rect.width / 2 ? idx + 1 : idx;
    }
    return { groupId: targetGroupId, toIndex, guide: dropGuideFor(targetGroupId, toIndex) };
  };

  const startPointerDrag = (e: React.PointerEvent, tab: WorkspaceTab, index: number) => {
    if (e.button !== 0) return;
    pointerDrag.current = {
      startX: e.clientX,
      startY: e.clientY,
      index,
      tabId: tab.id,
      dragging: false,
      bodyCursor: document.body.style.cursor,
    };

    const onMove = (ev: PointerEvent) => {
      const drag = pointerDrag.current;
      if (!drag) return;
      if (ev.buttons === 0) { onUp(ev); return; } // 松手事件被 webview 吞掉时自愈
      const dist = Math.abs(ev.clientX - drag.startX) + Math.abs(ev.clientY - drag.startY);
      if (!drag.dragging && dist > 6) {
        drag.dragging = true;
        document.body.style.cursor = "grabbing";
        setDraggingTabId(tab.id);
        beginGlobalDrag(); // 拖拽期让 webview/iframe 失明
      }
      if (!drag.dragging) return;
      ev.preventDefault();
      setDragPreview({ x: ev.clientX, y: ev.clientY, tab });
      const target = dropTargetAt(ev.clientX, ev.clientY);
      setOverIdx(target?.groupId === groupId ? target.toIndex : null);
      setDropGuide(target?.guide || null);
    };

    const onUp = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      const drag = pointerDrag.current;
      pointerDrag.current = null;
      document.body.style.cursor = drag?.bodyCursor || "";
      setOverIdx(null);
      setDraggingTabId(null);
      setDragPreview(null);
      setDropGuide(null);
      if (drag?.dragging) endGlobalDrag();
      if (!drag?.dragging) return;
      suppressClick.current = true;
      window.setTimeout(() => { suppressClick.current = false; }, 0);
      const target = dropTargetAt(ev.clientX, ev.clientY);
      if (!target) return;
      if (target.groupId === groupId) reorderWithinGroup(drag.index, target.toIndex);
      else actions.moveFromGroup(groupId, drag.tabId, target.groupId, target.toIndex);
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  const openTabMenu = (e: React.MouseEvent, tab: WorkspaceTab) => {
    e.preventDefault();
    e.stopPropagation();
    actions.activate(groupId, tab.id);
    const idx = tabs.findIndex((t) => t.id === tab.id);
    const items: MenuItem[] = [
      { label: "移动到另一侧", icon: <PanelRight size={13} />, onClick: () => actions.moveToOther(groupId, tab.id) },
      "divider",
      { label: "关闭", icon: <X size={13} />, onClick: () => actions.close(groupId, tab.id) },
      { label: "关闭其他标签", icon: <X size={13} />, onClick: () => actions.closeOthers(groupId, tab.id), disabled: tabs.length <= 1 },
      { label: "关闭右侧标签", icon: <X size={13} />, onClick: () => actions.closeToRight(groupId, tab.id), disabled: idx < 0 || idx >= tabs.length - 1 },
      "divider",
      { label: "关闭本组", icon: <X size={13} />, onClick: () => actions.closeGroup(groupId) },
    ];
    setMenu({ x: e.clientX, y: e.clientY, items });
  };

  return (
    // 三段结构(Firefox 式):左右功能钮钉死,只有中间标签区内滚 —— 标签再多也挤不走两端
    <div
      data-tab-drop-group={groupId}
      data-tab-count={tabs.length}
      className="flex items-stretch h-[42px] bg-bg-raised border-b border-border shrink-0"
    >
      {/* 侧边栏开关:侧栏展开时汉堡在侧栏头部,这里只在收起(或移动端)时出现 */}
      {onOpenNav && (
        <button
          onClick={onOpenNav}
          className={[
            "px-2.5 flex items-center justify-center text-text-dim hover:text-text hover:bg-bg-hover border-r border-border shrink-0",
            navOpen ? "md:hidden" : "",
          ].join(" ")}
          title="展开侧边栏"
        >
          <PanelLeft size={16} />
        </button>
      )}

      {/* 标签滚动区:宽度 = min(内容, 可用),溢出内滚 */}
      <div
        ref={scrollRef}
        onWheel={onWheel}
        data-tab-bar-group={groupId}
        className="flex items-stretch overflow-x-auto no-scrollbar min-w-0"
      >
      {tabs.map((t, idx) => {
        const Icon = tabIconFor(t);
        const active = t.id === activeId;
        const running = t.kind === "chat" && t.status === "running";
        const unread = t.kind === "chat" && t.unread && !active;
        const dirty = t.kind === "file" && dirtyIds.has(t.id);
        const preview = t.id === previewId;
        return (
          <div
            key={t.id}
            data-tab-index={idx}
            data-tab-id={t.id}
            onPointerDown={(e) => startPointerDrag(e, t, idx)}
            onClick={(e) => {
              if (suppressClick.current) { e.preventDefault(); return; }
              actions.activate(groupId, t.id);
            }}
            onAuxClick={(e) => { if (e.button === 1) actions.close(groupId, t.id); }} // 中键关闭
            onContextMenu={(e) => openTabMenu(e, t)}
            title={t.title}
            className={[
              "group flex items-center gap-1.5 pl-3 pr-2 max-w-[200px] cursor-pointer select-none border-r border-border shrink-0",
              active
                ? "bg-bg text-text border-t-2 border-t-accent -mt-px"
                : "text-text-dim hover:bg-bg-hover hover:text-text border-t-2 border-t-transparent",
              draggingTabId === t.id ? "opacity-40" : "",
              overIdx === idx || overIdx === idx + 1 ? "bg-accent-soft" : "",
            ].join(" ")}
          >
            <span className="relative shrink-0">
              {t.kind === "web" ? (
                <Favicon url={t.url} override={t.favicon} size={13} className={active ? "" : "opacity-70"} />
              ) : (
                <Icon size={13} className={active ? tabColorFor(t) : "opacity-70"} />
              )}
              {running && (
                <span className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full bg-accent animate-pulse" />
              )}
            </span>
            <span className={["text-[13px] truncate flex-1", preview ? "italic" : ""].join(" ")}>{t.title}</span>
            {unread && <span className="w-1.5 h-1.5 rounded-full bg-success shrink-0" />}
            <button
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => { e.stopPropagation(); actions.close(groupId, t.id); }}
              className="w-4 h-4 rounded flex items-center justify-center shrink-0 hover:bg-bg-inset"
              title="关闭"
            >
              {dirty ? (
                <>
                  <Circle size={8} className="fill-current text-text-dim group-hover:hidden" />
                  <X size={12} className="hidden group-hover:block" />
                </>
              ) : (
                <X size={12} className={active ? "opacity-60 hover:opacity-100" : "opacity-0 group-hover:opacity-60 hover:!opacity-100"} />
              )}
            </button>
          </div>
        );
      })}

      </div>

      {/* 加号:方案 B 类型菜单,不创建新标签页。
          左边线补齐(-ml-px 与最后一个标签的右边线重叠,避免双线) */}
      <button
        onClick={(e) => actions.newTab(groupId, e.currentTarget)}
        className="px-2.5 flex items-center justify-center text-text-faint hover:text-accent hover:bg-bg-hover shrink-0 border-l border-border -ml-px"
        title="新建…"
      >
        <Plus size={15} />
      </button>

      {showSideToggle && (
        <button
          onClick={actions.toggleSideGroup}
          className={[
            "ml-auto flex px-2 items-center justify-center border-l border-border shrink-0",
            sideToggleOpen ? "text-accent bg-accent-soft hover:text-accent" : "text-text-faint hover:text-text hover:bg-bg-hover",
          ].join(" ")}
          title={sideToggleOpen ? "收起右侧区域" : "开启右侧区域"}
        >
          {/* 分割线居中 = 左右平分,这是分屏;偏一侧的那种(PanelLeft/Right)留给侧边栏开合 */}
          <Columns2 size={14} />
        </button>
      )}
      {dropGuide && (
        <>
          <div
            data-drop-guide="zone"
            className="fixed z-50 pointer-events-none border border-accent/40 bg-accent-soft/20"
            style={{
              left: dropGuide.zone.x,
              top: dropGuide.zone.y,
              width: dropGuide.zone.width,
              height: dropGuide.zone.height,
            }}
          />
          <div
            data-drop-guide="marker"
            className="fixed z-[60] pointer-events-none w-0.5 rounded-full bg-accent shadow-[0_0_0_2px_rgba(35,131,226,0.16)]"
            style={{
              left: dropGuide.marker.x - 1,
              top: dropGuide.marker.y,
              height: dropGuide.marker.height,
            }}
          />
        </>
      )}
      {dragPreview && (
        <DragPreview x={dragPreview.x} y={dragPreview.y} tab={dragPreview.tab} />
      )}
      {menu && <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />}
    </div>
  );
}

function DragPreview({ x, y, tab }: { x: number; y: number; tab: WorkspaceTab }) {
  const Icon = tabIconFor(tab);
  return (
    <div
      data-drag-preview="tab"
      className="fixed z-[70] pointer-events-none flex h-8 max-w-[240px] items-center gap-1.5 rounded border border-border-strong bg-bg px-2 text-[13px] text-text shadow-lg"
      style={{ left: x + 10, top: y + 8 }}
    >
      {tab.kind === "web" ? (
        <Favicon url={tab.url} override={tab.favicon} size={13} />
      ) : (
        <Icon size={13} className={tabColorFor(tab)} />
      )}
      <span className="truncate">{tab.title}</span>
    </div>
  );
}

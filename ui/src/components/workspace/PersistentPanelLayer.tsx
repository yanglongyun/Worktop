// 常驻层:全部网页/终端在这一层存活,分组只是投影位置。
//
// 为什么在布局层而不在分组里:webview/PTY 视图绑在 DOM 生命周期上,分组子树里的挂载
// 在标签跨组移动时必然卸载重建(React 无法跨父迁移 DOM)。这里所有面板同父、key 稳定,
// 跨分屏移动时 React 保住实例;side 收起也只是 display:none,进程/登录态原地等待。
//
// 定位:每个分组内容区标 [data-panel-host],ResizeObserver 量出相对布局容器的矩形,
// 面板绝对定位投影过去。z-10 低于分屏把手(z-20),拖宽不受影响。
import { useCallback, useEffect, useState, type RefObject } from "react";
import { TerminalPanel } from "./panels/TerminalPanel";
import { WebPanel } from "./panels/WebPanel";
import { isTerminalTab, isWebTab, type TerminalTab, type WebTab, type WorkspaceGroupId, type WorkspaceGroupState } from "./types";

type Socket = { send: (m: any) => void; on: (t: string, fn: (p: any) => void) => () => void };
type HostRect = { left: number; top: number; width: number; height: number };

export function PersistentPanelLayer({
  containerRef,
  allGroups,
  visibleGroupIds,
  socket,
  onUpdateWebTab,
  onCloseTab,
  onFocusGroup,
}: {
  /** 布局容器(position:relative):矩形以它为基准,面板也挂在它下面。 */
  containerRef: RefObject<HTMLDivElement | null>;
  /** 全部分组(含收起的 side):生命在此,不随分屏开合。 */
  allGroups: WorkspaceGroupState[];
  visibleGroupIds: WorkspaceGroupId[];
  socket: Socket;
  onUpdateWebTab: (id: string, patch: Partial<Pick<WebTab, "title" | "url" | "favicon">>) => void;
  onCloseTab: (groupId: WorkspaceGroupId, id: string) => void;
  onFocusGroup: (groupId: WorkspaceGroupId) => void;
}) {
  const [hostRects, setHostRects] = useState<Record<string, HostRect>>({});

  const measure = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    const base = container.getBoundingClientRect();
    const next: Record<string, HostRect> = {};
    container.querySelectorAll<HTMLElement>("[data-panel-host]").forEach((el) => {
      const r = el.getBoundingClientRect();
      next[el.dataset.panelHost || ""] = { left: r.left - base.left, top: r.top - base.top, width: r.width, height: r.height };
    });
    setHostRects((prev) => {
      const keys = Object.keys(next);
      const same = keys.length === Object.keys(prev).length && keys.every((k) => {
        const a = prev[k];
        const b = next[k];
        return a && a.left === b.left && a.top === b.top && a.width === b.width && a.height === b.height;
      });
      return same ? prev : next;
    });
  }, [containerRef]);

  // 容器 + 各内容区都被观察:分屏拖动、侧栏伸缩、窗口变化 → 内容区尺寸必变 → 自动重量
  const visibleKey = visibleGroupIds.join(",");
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(container);
    container.querySelectorAll<HTMLElement>("[data-panel-host]").forEach((el) => observer.observe(el));
    window.addEventListener("resize", measure);
    return () => { observer.disconnect(); window.removeEventListener("resize", measure); };
  }, [containerRef, measure, visibleKey]);

  return (
    <>
      {allGroups.flatMap((g) =>
        g.tabs
          .filter((t): t is WebTab | TerminalTab => isWebTab(t) || isTerminalTab(t))
          .map((t) => {
            const rect = hostRects[g.id];
            const visible = !!rect && visibleGroupIds.includes(g.id) && g.activeId === t.id;
            return (
              <div
                key={t.id}
                onMouseDown={() => onFocusGroup(g.id)}
                data-focus-group={g.id}
                className="absolute z-10 flex-col bg-bg"
                style={visible
                  ? { display: "flex", left: rect.left, top: rect.top, width: rect.width, height: rect.height }
                  : { display: "none" }}
              >
                {isWebTab(t)
                  ? <WebPanel tab={t} socket={socket} onUpdate={onUpdateWebTab} onFocus={onFocusGroup} groupId={g.id} />
                    : <TerminalPanel tab={t} socket={socket} onClose={() => onCloseTab(g.id, t.id)} />}
              </div>
            );
          }),
      )}
    </>
  );
}

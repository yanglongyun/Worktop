import { type AppInfo, appsApi } from "../../../api/apps";
// 应用列表:活动栏第四格。
//
// 它是**启动器**,不是面板 —— 组件挂进侧栏那格里,应用开在标签页。
// 所以这里除了名字还得有「跑没跑」:应用有进程、会按需启停、会崩,
// 状态看不见的话用户根本不知道该不该等。
import { useCallback, useEffect, useState } from "react";
import { ContextMenu, type MenuItem } from "../../ui";
import { AlertTriangle, Pin, PinOff, Plus, RotateCw, Square } from "lucide-react";
import { isPinned, togglePin } from "../../../lib/railPins";
import { PanelCreateAction } from "./PanelCreateAction";

type Socket = { send: (m: any) => void; on: (t: string, fn: (p: any) => void) => () => void };

/** 没有 icon.svg 就用名字首字 —— 比一个通用占位图标好认。 */
const Initial = ({ name }: { name: string }) => (
  <span className="shrink-0 w-8 h-8 rounded-lg bg-bg-inset text-text-dim
    flex items-center justify-center text-[14px] font-medium">
    {Array.from(name)[0] || "?"}
  </span>
);

const DOT: Record<string, string> = {
  ready: "bg-success",
  starting: "bg-accent animate-pulse",
  failed: "bg-danger",
  invalid: "bg-danger",
};

export function AppsPanel({ socket, onOpenApp, onCreate }: {
  socket: Socket;
  onOpenApp: (app: AppInfo) => void;
  /** 让 AI 造一个应用 —— 动作住在 PanelHost(要开对话、发提示词)。 */
  onCreate?: () => void;
}) {
  const [apps, setApps] = useState<AppInfo[]>([]);
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);

  const load = useCallback(() => { void appsApi.listApps().then(setApps).catch(() => {}); }, []);
  useEffect(() => { load(); }, [load]);
  // 目录变了(AI 刚写完一个)、状态变了(起来了/崩了)都要跟上
  useEffect(() => socket.on("apps_changed", load), [socket, load]);
  useEffect(() => socket.on("app_status", load), [socket, load]);

  const onContext = (e: React.MouseEvent, app: AppInfo) => {
    e.preventDefault();
    e.stopPropagation();
    const running = app.status === "ready" || app.status === "starting";
    const pinned = isPinned("app", app.id);
    setMenu({
      x: e.clientX, y: e.clientY,
      items: [
        { label: "打开", onClick: () => onOpenApp(app), disabled: !!app.invalid },
        { label: pinned ? "从活动栏取消固定" : "固定到活动栏", icon: pinned ? <PinOff size={13} /> : <Pin size={13} />, disabled: !!app.invalid,
          onClick: () => { togglePin({ kind: "app", id: app.id, title: app.name, hasIcon: app.hasIcon }); } },
        { label: "重启", icon: <RotateCw size={13} />, disabled: !!app.invalid,
          onClick: () => { void appsApi.restartApp(app.id).then(load).catch(() => {}); } },
        { label: "停止", icon: <Square size={13} />, disabled: !running,
          onClick: () => { void appsApi.stopApp(app.id).then(load).catch(() => {}); } },
      ],
    });
  };

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      {onCreate && apps.length > 0 && (
        <PanelCreateAction label="创建应用…" onClick={onCreate} />
      )}
      <div className="flex-1 min-h-0 overflow-y-auto">
      {apps.map((app) => (
        <div
          key={app.id}
          onClick={() => { if (!app.invalid) onOpenApp(app); }}
          onContextMenu={(e) => onContext(e, app)}
          title={app.invalid || `${app.name}${app.description ? `\n${app.description}` : ""}`}
          className={[
            "group flex items-center gap-2.5 py-2 pl-3 pr-2 select-none",
            app.invalid ? "cursor-default text-text-faint" : "cursor-pointer text-text hover:bg-bg-hover",
          ].join(" ")}
        >
          {app.hasIcon
            ? <img src={`/api/apps/icon?id=${encodeURIComponent(app.id)}`} alt="" className="shrink-0 w-8 h-8 rounded-lg" />
            : <Initial name={app.name} />}
          <div className="min-w-0 flex-1">
            <div className="truncate text-[13.5px] font-medium leading-[18px]">{app.name}</div>
            {app.invalid ? (
              <div className="flex items-center gap-1 text-[11px] text-danger">
                <AlertTriangle size={10} className="shrink-0" />
                <span className="truncate">{app.invalid}</span>
              </div>
            ) : app.description ? (
              <div className="truncate text-[11.5px] text-text-faint leading-[15px]">{app.description}</div>
            ) : null}
          </div>
          {!app.invalid && DOT[app.status] && (
            <span className={`shrink-0 w-1.5 h-1.5 rounded-full ${DOT[app.status]}`}
              title={app.status === "ready" ? "运行中" : app.status === "starting" ? "启动中" : app.error || "启动失败"} />
          )}
        </div>
      ))}

      {!apps.length && (
        <div className="px-4 py-14 flex flex-col items-center text-center">
          <div className="text-[12.5px] text-text-faint">还没有应用</div>
          {onCreate && (
            <button
              onClick={onCreate}
              className="mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-accent text-white text-[13px] hover:opacity-90 transition-opacity"
            >
              <Plus size={13} /> 创建应用
            </button>
          )}
        </div>
      )}

      </div>
      {menu && <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />}
    </div>
  );
}

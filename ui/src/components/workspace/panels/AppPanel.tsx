import { appsApi } from "../../../api/apps";
// 应用的身体:一个 iframe,指向 app **自己的 origin**(http://127.0.0.1:<app 端口>)。
//
// 地址不缓存 —— 端口每次启动都变,挂载时现向宿主取(取址顺手会把没起的应用拉起)。
// 真 origin 意味着 app 写 href="/style.css" 这种绝对路径也是对的
// (0.8.0 用路径前缀挂载踩过的坑,这套模型从根上不存在)。
import { useCallback, useEffect, useState } from "react";
import type { AppTab } from "../types";
import { AlertTriangle, RotateCw } from "../../ui/icons";

type Socket = { send: (m: any) => void; on: (t: string, fn: (p: any) => void) => () => void };

export function AppPanel({ tab, socket }: { tab: AppTab; socket: Socket }) {
  const [origin, setOrigin] = useState<string | null>(null);
  const [error, setError] = useState<string>("");
  const [stopped, setStopped] = useState(false);
  // 重启后要换掉 iframe:同一个 src 不会自己重载,而端口很可能已经变了
  const [nonce, setNonce] = useState(0);

  const resolve = useCallback(() => {
    setError("");
    setStopped(false);
    setOrigin(null);
    appsApi.appAddress(tab.appId)
      .then((url) => { setOrigin(url); setNonce((n) => n + 1); })
      .catch((e: any) => setError(e?.message || "启动失败"));
  }, [tab.appId]);

  useEffect(() => { resolve(); }, [resolve]);

  // 应用被停掉(手动或闲置回收)时,别留一个后端已死的 iframe 在那儿装活着
  useEffect(() => socket.on("app_status", (p: any) => {
    if (String(p?.appId) !== tab.appId) return;
    if (p.status === "stopped" || p.status === "failed") {
      setOrigin(null);
      setError(p.status === "failed" ? String(p.error || "应用启动失败") : "");
      setStopped(p.status === "stopped");
    }
  }), [socket, tab.appId]);

  if (error) {
    return (
      <div className="flex-1 min-h-0 flex flex-col items-center justify-center gap-3 bg-bg px-6 text-center">
        <AlertTriangle size={26} className="text-danger" />
        <div className="text-[14px] text-text">{tab.title} 起不来</div>
        <div className="max-w-lg text-[12px] text-text-faint font-mono leading-relaxed break-all">{error}</div>
        <button
          onClick={resolve}
          className="mt-1 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-accent text-white text-[13px] hover:opacity-90 transition-opacity"
        >
          <RotateCw size={13} /> 重试
        </button>
      </div>
    );
  }

  // 闲置回收后停在这儿 —— 说实话,并给一个再起来的入口(手动停止的那张标签已经被关掉了)
  if (stopped) {
    return (
      <div className="flex-1 min-h-0 flex flex-col items-center justify-center gap-3 bg-bg px-6 text-center">
        <div className="text-[14px] text-text">{tab.title} 已停止</div>
        <div className="text-[12px] text-text-faint">闲置太久被回收了,随时可以再起来。</div>
        <button
          onClick={resolve}
          className="mt-1 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-accent text-white text-[13px] hover:opacity-90 transition-opacity"
        >
          <RotateCw size={13} /> 启动
        </button>
      </div>
    );
  }

  if (!origin) {
    return (
      <div className="flex-1 min-h-0 flex items-center justify-center bg-bg">
        <div className="text-[13px] text-text-faint">正在启动 {tab.title}…</div>
      </div>
    );
  }

  return (
    // 嵌入义务(契约):跨源 iframe 默认关掉剪贴板/全屏/指针锁定,宿主必须放开 ——
    // 图片编辑器里 Ctrl+V 贴不进图,用户不会怪宿主,只会觉得这个应用是坏的
    <iframe
      key={`${tab.appId}:${nonce}`}
      src={origin}
      title={tab.title}
      allow="clipboard-read; clipboard-write; fullscreen; pointer-lock"
      className="flex-1 min-h-0 w-full border-0 bg-bg"
    />
  );
}

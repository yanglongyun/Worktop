import { widgetsApi } from "../../api/widgets";
// 组件的身体:一个 iframe,指向组件**自己的 origin**(http://127.0.0.1:<组件端口>/)。
//
// 不用 sandbox 的不透明源:每个组件一个端口 = 一个真 origin,localStorage / cookie
// 天然互不可见,隔离由 origin 本身提供。
// 断网由服务端下发的 CSP(connect-src 'self')管,不靠 sandbox。
import { useEffect, useState } from "react";
import type { WidgetDef } from "../sidebar/registry";

export function WidgetFrame({ widget }: { widget: WidgetDef }) {
  const [src, setSrc] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setSrc(null); setError(null);
    widgetsApi.widgetUrl(widget.id)
      .then((url) => { if (!cancelled) setSrc(url); })
      .catch((e: any) => { if (!cancelled) setError(String(e?.message || e)); });
    return () => { cancelled = true; };
  }, [widget.id]);

  if (error) {
    return (
      <div className="flex-1 min-h-0 flex items-center justify-center p-6 text-center">
        <div className="text-[13px] text-text-faint">组件起不来:{error}</div>
      </div>
    );
  }
  if (!src) return <div className="flex-1 min-h-0" />;
  return (
    <iframe
      src={src}
      title={widget.name}
      // 组件是跨源 iframe(自己的端口 = 自己的 origin),不显式授权的话
      // navigator.clipboard.writeText 会被权限策略拒 —— 复制按钮全部哑掉
      allow="clipboard-write"
      className="flex-1 min-h-0 w-full border-0 bg-bg"
    />
  );
}

import { useEffect, useRef, type ReactNode } from "react";
import { Check } from "./icons";

export type MenuItem = {
  label: string;
  icon?: ReactNode;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
  /** 勾选项:给出布尔值即占用左侧勾位(其余项对齐同一条竖线)。 */
  checked?: boolean;
  /** 点完不关菜单。仅用于「改了立刻能看见效果」的勾选项(如列表显示项)。 */
  keepOpen?: boolean;
} | "divider";

export function ContextMenu({
  x,
  y,
  items,
  onClose,
}: {
  x: number;
  y: number;
  items: MenuItem[];
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    // 点到 iframe/webview 上宿主收不到任何鼠标事件,但焦点会移走 —— blur 兜底关菜单
    const onBlur = () => onClose();
    document.addEventListener("keydown", onKey);
    window.addEventListener("blur", onBlur);
    return () => {
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("blur", onBlur);
    };
  }, [onClose]);

  const hasChecks = items.some((item) => item !== "divider" && item.checked !== undefined);
  const viewportW = typeof window !== "undefined" ? window.innerWidth : 1024;
  const viewportH = typeof window !== "undefined" ? window.innerHeight : 768;
  const safeX = Math.min(x, viewportW - 200);
  const safeY = Math.min(y, viewportH - items.length * 30 - 16);

  return (
    <>
    {/* 透明遮罩铺满全窗、盖在 iframe 之上:点哪里都先落在它身上 → 关菜单。右键同理。 */}
    <div
      className="fixed inset-0 z-50"
      onMouseDown={onClose}
      onContextMenu={(e) => { e.preventDefault(); onClose(); }}
    />
    <div
      ref={ref}
      className="fixed z-50 min-w-[180px] rounded-md border border-border bg-surface shadow-[0_6px_20px_rgba(15,15,15,0.12),0_2px_4px_rgba(15,15,15,0.08)] py-1"
      style={{ left: safeX, top: safeY }}
    >
      {/* 有勾选项时,所有行统一让出左侧勾位 —— 否则勾上/取消会让文字左右跳 */}
      {items.map((item, i) => {
        if (item === "divider") {
          return <div key={i} className="h-px bg-border my-1" />;
        }
        return (
          <button
            key={i}
            disabled={item.disabled}
            onClick={() => { item.onClick(); if (!item.keepOpen) onClose(); }}
            className={[
              "w-full flex items-center gap-2.5 px-3 py-2 text-[14px] text-left transition-colors",
              item.disabled
                ? "text-text-faint cursor-not-allowed"
                : item.danger
                  ? "text-danger hover:bg-bg-hover"
                  : "text-text hover:bg-bg-hover",
            ].join(" ")}
          >
            {hasChecks && (
              <span className="shrink-0 w-3.5 h-3.5 flex items-center justify-center text-accent">
                {item.checked && <Check size={13} strokeWidth={2.5} />}
              </span>
            )}
            {item.icon && <span className="shrink-0 w-3.5 h-3.5 flex items-center justify-center text-text-dim">{item.icon}</span>}
            <span className="flex-1">{item.label}</span>
          </button>
        );
      })}
    </div>
    </>
  );
}

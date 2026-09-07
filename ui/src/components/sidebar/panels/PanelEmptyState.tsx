import type { ReactNode } from "react";

export function PanelEmptyState({ title, description, action, icon, onAction }: {
  title: string;
  description: string;
  action: string;
  icon: ReactNode;
  onAction: () => void;
}) {
  return (
    <div className="px-4 py-10 flex flex-col items-center text-center">
      <div className="text-[13px] text-text-dim">{title}</div>
      <div className="mt-1 min-h-[3.25em] text-[11.5px] text-text-faint leading-relaxed">{description}</div>
      <button
        onClick={onAction}
        className="mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-accent text-white text-[13px] hover:opacity-90 transition-opacity"
      >
        {icon} {action}
      </button>
    </div>
  );
}

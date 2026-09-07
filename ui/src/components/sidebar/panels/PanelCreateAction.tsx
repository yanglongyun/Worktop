import { Plus } from "../../ui/icons";

export function PanelCreateAction({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="shrink-0 h-8 flex items-center gap-1.5 pl-3 pr-2 border-b border-border cursor-pointer select-none text-text hover:bg-bg-hover"
    >
      <Plus size={13} className="shrink-0" />
      <span className="text-[12.5px] leading-[18px]">{label}</span>
    </button>
  );
}

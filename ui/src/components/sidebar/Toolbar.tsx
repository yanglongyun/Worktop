// 三段共用的工具行:搜索 + ＋(本段主动作)+ ⋯(本段次要操作)。
// 搜索只搜本段;＋ 可以是一个动作,也可以是一小组动作(弹菜单);⋯ 每次打开现算菜单项(勾选项要即时跟着变)。
import { useState } from "react";
import { MoreHorizontal, Plus, X } from "../ui/icons";
import { ContextMenu, type MenuItem } from "../ui";

export function Toolbar({
  value,
  onChange,
  placeholder,
  add,
  more,
}: {
  value: string;
  onChange: (next: string) => void;
  placeholder: string;
  /** 主动作:给 onClick 就是直接干;给 items 就弹一小组。不给 = 本段没有主动作(如历史)。 */
  add?: { title: string; onClick?: () => void; items?: () => MenuItem[] };
  more?: () => MenuItem[];
}) {
  const [addAt, setAddAt] = useState<{ x: number; y: number } | null>(null);
  const [moreAt, setMoreAt] = useState<{ x: number; y: number } | null>(null);
  const anchor = (el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    return { x: r.right - 176, y: r.bottom + 4 };
  };
  const btn = "shrink-0 w-6 h-6 rounded flex items-center justify-center text-text-faint hover:text-text hover:bg-bg-hover transition-colors";

  return (
    <div className="shrink-0 flex items-center gap-1 px-2 py-1.5 border-b border-border">
      <div className="flex-1 min-w-0 relative">
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Escape") { onChange(""); (e.target as HTMLInputElement).blur(); } }}
          placeholder={placeholder}
          spellCheck={false}
          className="w-full h-6 pl-2 pr-6 rounded bg-bg-inset text-[12px] text-text placeholder:text-text-faint outline-none focus:ring-1 ring-accent/40"
        />
        {value && (
          <button
            onClick={() => onChange("")}
            title="清除"
            className="absolute right-0.5 top-0.5 w-5 h-5 rounded flex items-center justify-center text-text-faint hover:text-text"
          >
            <X size={11} />
          </button>
        )}
      </div>
      {add && (
        <button
          title={add.title}
          onClick={(e) => { if (add.items) setAddAt(anchor(e.currentTarget)); else add.onClick?.(); }}
          className={btn}
        >
          <Plus size={15} />
        </button>
      )}
      {more && (
        <button title="更多" onClick={(e) => setMoreAt(anchor(e.currentTarget))} className={btn}>
          <MoreHorizontal size={15} />
        </button>
      )}
      {addAt && add?.items && <ContextMenu x={addAt.x} y={addAt.y} items={add.items()} onClose={() => setAddAt(null)} />}
      {moreAt && more && <ContextMenu x={moreAt.x} y={moreAt.y} items={more()} onClose={() => setMoreAt(null)} />}
    </div>
  );
}

// 规则:就地管理,全在输入框这一行完成,不进设置页。
//
// 只有两个概念:开关是开关,规则是内容。规则唯一的作用是写进提示词 ——
// 没有硬闸、没有编译,界面上也不说「拦截」。盾牌只是这个开关的图标:
// 关着是灰的,开着是亮的,不点开也知道现在规则生不生效。
import { useEffect, useRef, useState } from "react";
import { AlertTriangle, ArrowLeft, Check, ChevronRight, GripVertical, Loader2, Plus, Shield, ShieldCheck, Trash2 } from "lucide-react";
import { permissionApi, type Rule } from "../../lib/permission";
import { beginGlobalDrag, endGlobalDrag } from "../../lib/drag";
import { Switch } from "../ui";

export function RulesControl({ on, onChange, quiet = false }: { on: boolean; onChange: (next: boolean) => void; quiet?: boolean }) {
  const [open, setOpen] = useState(false);
  const [rules, setRules] = useState<Rule[]>([]);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const boxRef = useRef<HTMLDivElement>(null);

  const reload = () => { void permissionApi.listRules().then(setRules).catch(() => {}); };
  useEffect(() => { reload(); }, []);
  useEffect(() => { if (open) { reload(); setError(""); } }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!boxRef.current?.contains(e.target as any)) { setOpen(false); setDetailId(null); }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (detailId) setDetailId(null); else setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open, detailId]);

  const liveCount = rules.filter((r) => r.enabled).length;

  // ── 拖动排序:超过阈值才算拖,拖拽期挂全局护栏 ──
  const listRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ id: string; from: number; to: number; startY: number; dragging: boolean } | null>(null);
  const suppressClick = useRef(false);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);
  const indexAt = (y: number) => {
    const rows = [...(listRef.current?.querySelectorAll<HTMLElement>("[data-rule-index]") || [])];
    for (const el of rows) {
      const r = el.getBoundingClientRect();
      if (y < r.top + r.height / 2) return Number(el.dataset.ruleIndex);
    }
    return rows.length;
  };
  const applyReorder = (from: number, to: number) => {
    const next = [...rules];
    const [moved] = next.splice(from, 1);
    next.splice(to > from ? to - 1 : to, 0, moved);
    setRules(next);
    void permissionApi.reorderRules(next.map((r) => r.id)).catch(reload);
  };
  const startDrag = (e: React.PointerEvent, rule: Rule, index: number) => {
    if (e.button !== 0) return;
    e.preventDefault(); e.stopPropagation();
    dragRef.current = { id: rule.id, from: index, to: index, startY: e.clientY, dragging: false };
    const onMove = (ev: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      if (ev.buttons === 0) { onUp(); return; }
      if (!drag.dragging && Math.abs(ev.clientY - drag.startY) > 5) {
        drag.dragging = true; setDragId(drag.id); document.body.style.cursor = "grabbing"; beginGlobalDrag();
      }
      if (!drag.dragging) return;
      ev.preventDefault();
      drag.to = indexAt(ev.clientY);
      setOverIndex(drag.to);
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      const drag = dragRef.current;
      dragRef.current = null; setDragId(null); setOverIndex(null);
      if (!drag?.dragging) return;
      document.body.style.cursor = ""; endGlobalDrag();
      suppressClick.current = true;
      window.setTimeout(() => { suppressClick.current = false; }, 0);
      if (drag.to !== drag.from && drag.to !== drag.from + 1) applyReorder(drag.from, drag.to);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  const toggleRule = (rule: Rule) => {
    void permissionApi.updateRule(rule.id, { enabled: !rule.enabled }).then(reload).catch(() => {});
  };
  const add = () => {
    const text = draft.trim();
    if (!text || busy) return;
    setBusy(true); setError("");
    void permissionApi.createRule(text)
      .then(() => { setDraft(""); reload(); })
      .catch((e) => setError(e?.message || "没能保存"))
      .finally(() => setBusy(false));
  };

  const label = !on ? "规则已关" : liveCount ? `规则 · ${liveCount}` : "规则";
  const Icon = on ? ShieldCheck : Shield;

  return (
    <div ref={boxRef} className="relative">
      {/* 盾牌按钮:开着亮、关着灰 */}
      <button
        onClick={() => { setOpen((v) => !v); setDetailId(null); }}
        title="规则:写给助手的要求,会进提示词"
        className={[
          "inline-flex items-center gap-1.5 h-7 px-2 rounded-md text-[12.5px] transition-colors",
          on && !quiet ? "text-accent bg-accent/10 hover:bg-accent/[0.16]" : "text-text-faint hover:text-text-dim hover:bg-bg-hover",
        ].join(" ")}
      >
        <Icon size={14} />
        <span>{label}</span>
      </button>

      {open && (
        <div className="absolute bottom-full left-0 mb-2 z-50 w-[360px] rounded-xl border border-border
          bg-surface shadow-[0_10px_30px_rgba(15,15,15,0.14),0_2px_6px_rgba(15,15,15,0.08)] overflow-hidden">
          <div className="flex items-center gap-2.5 px-3.5 py-3">
            <span className={["shrink-0 w-8 h-8 rounded-lg flex items-center justify-center", on ? "bg-accent/[0.12] text-accent" : "bg-bg-inset text-text-faint"].join(" ")}>
              <Icon size={16} />
            </span>
            <span className="flex-1 min-w-0">
              <span className="block text-[13.5px] font-medium text-text leading-tight">{on ? "规则" : "规则已关闭"}</span>
              <span className="block text-[11.5px] text-text-faint mt-0.5 leading-tight">
                {on ? (liveCount ? `${liveCount} 条会写进提示词` : "还没有规则") : "不写进提示词,助手不会先问"}
              </span>
            </span>
            <Switch on={on} label={on ? "关闭规则" : "打开规则"} onChange={onChange} />
          </div>

          <div className="relative overflow-hidden border-t border-border" style={detailId ? { minHeight: 220 } : undefined}>
            <div className={detailId ? "pointer-events-none opacity-50" : ""}>
              <div ref={listRef} className="max-h-56 overflow-y-auto pb-1">
                {rules.map((rule, index) => (
                  <div
                    key={rule.id}
                    data-rule-index={index}
                    onClick={() => { if (!suppressClick.current) setDetailId(rule.id); }}
                    className={["group relative flex items-center gap-2 pl-1 pr-2 py-1.5 cursor-pointer transition-colors hover:bg-bg-hover", dragId === rule.id ? "opacity-40" : ""].join(" ")}
                  >
                    {overIndex === index && <span className="absolute left-3 right-3 -top-px h-0.5 rounded bg-accent" />}
                    <span
                      onPointerDown={(e) => startDrag(e, rule, index)}
                      onClick={(e) => e.stopPropagation()}
                      title="拖动排序"
                      className="shrink-0 w-4 flex justify-center text-text-faint cursor-grab opacity-0 group-hover:opacity-70 hover:!opacity-100 transition-opacity"
                    >
                      <GripVertical size={12} />
                    </span>
                    <button
                      onClick={(e) => { e.stopPropagation(); toggleRule(rule); }}
                      title={rule.enabled ? "停用" : "启用"}
                      className={["shrink-0 w-3.5 h-3.5 rounded border flex items-center justify-center transition-colors", rule.enabled ? "bg-accent border-accent text-white" : "border-border-strong text-transparent"].join(" ")}
                    >
                      <Check size={9} strokeWidth={3.5} />
                    </button>
                    <div className={`min-w-0 flex-1 text-[12.5px] leading-snug ${rule.enabled ? "text-text" : "text-text-faint"}`}>{rule.text}</div>
                    <ChevronRight size={13} className="shrink-0 text-text-faint opacity-50 group-hover:opacity-100" />
                  </div>
                ))}
                {overIndex === rules.length && rules.length > 0 && (
                  <div className="relative h-0"><span className="absolute left-3 right-3 h-0.5 rounded bg-accent" /></div>
                )}
                {!rules.length && (
                  <div className="px-3.5 py-3 text-[12px] text-text-faint leading-relaxed">
                    还没有规则。例如:<br />「删我文档以外的东西之前先问我」<br />「不要加署名」
                  </div>
                )}
              </div>
              <div className="flex items-center gap-1.5 p-2 border-t border-border">
                <input
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") add(); }}
                  placeholder="新增规则…"
                  className="flex-1 min-w-0 h-7 px-2 rounded-md border border-border bg-bg text-[12.5px] text-text placeholder:text-text-faint outline-none focus:border-accent transition-colors"
                />
                <button
                  onClick={add}
                  disabled={!draft.trim() || busy}
                  className="shrink-0 w-7 h-7 rounded-md flex items-center justify-center bg-accent text-white hover:opacity-90 disabled:opacity-30 transition-opacity"
                >
                  {busy ? <Loader2 size={13} className="animate-spin" /> : <Plus size={14} />}
                </button>
              </div>
              {error && (
                <div className="px-3.5 pb-2 -mt-0.5 flex items-start gap-1 text-[11px] text-danger">
                  <AlertTriangle size={10} className="shrink-0 mt-[2px]" /><span>{error}</span>
                </div>
              )}
            </div>
            {detailId && (
              <RuleDetail
                rule={rules.find((r) => r.id === detailId) || null}
                onBack={() => setDetailId(null)}
                onSaved={() => { setDetailId(null); reload(); }}
                onDeleted={() => { setDetailId(null); reload(); }}
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function RuleDetail({ rule, onBack, onSaved, onDeleted }: { rule: Rule | null; onBack: () => void; onSaved: () => void; onDeleted: () => void }) {
  const [text, setText] = useState(rule?.text || "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { setText(rule?.text || ""); setError(""); }, [rule?.id]);
  if (!rule) return null;
  const save = () => {
    const next = text.trim();
    if (!next || busy) return;
    if (next === rule.text) { onBack(); return; }
    setBusy(true);
    void permissionApi.updateRule(rule.id, { text: next }).then(onSaved).catch((e) => { setError(e?.message || "没能保存"); setBusy(false); });
  };
  const remove = () => {
    if (busy) return;
    setBusy(true);
    void permissionApi.deleteRule(rule.id).then(onDeleted).catch((e) => { setError(e?.message || "没能删除"); setBusy(false); });
  };
  return (
    <div className="absolute inset-0 bg-surface flex flex-col wb-slide-in">
      <div className="shrink-0 flex items-center gap-1.5 px-2.5 py-2 border-b border-border">
        <button onClick={onBack} title="返回列表" className="w-6 h-6 rounded-md flex items-center justify-center text-text-dim hover:text-text hover:bg-bg-hover transition-colors">
          <ArrowLeft size={14} />
        </button>
        <span className="text-[12.5px] font-medium text-text">编辑规则</span>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto px-3.5 py-3 flex flex-col gap-1.5">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={3}
          className="w-full min-h-[72px] px-2.5 py-2 rounded-lg border border-border bg-bg text-[12.5px] text-text leading-relaxed outline-none resize-none focus:border-accent transition-colors"
        />
        {error && (
          <div className="flex items-start gap-1 text-[11px] text-danger"><AlertTriangle size={10} className="shrink-0 mt-[2px]" /><span>{error}</span></div>
        )}
      </div>
      <div className="shrink-0 flex items-center gap-2 px-3 py-2.5 border-t border-border">
        <button onClick={save} disabled={!text.trim() || busy} className="inline-flex items-center gap-1.5 h-7 px-3 rounded-md bg-accent text-white text-[12.5px] hover:opacity-90 disabled:opacity-30 transition-opacity">
          {busy && <Loader2 size={12} className="animate-spin" />}保存
        </button>
        <button onClick={remove} disabled={busy} title="删除这条规则" className="ml-auto inline-flex items-center gap-1 h-7 px-2.5 rounded-md text-[12.5px] text-danger hover:bg-danger/10 disabled:opacity-40 transition-colors">
          <Trash2 size={12} /> 删除
        </button>
      </div>
    </div>
  );
}

import { useEffect, useRef, useState } from "react";
import { ArrowRight, Loader2, X } from "lucide-react";
import { api, type Settings } from "../../api";
import { ModelConnectionFields } from "../settings/ModelConnectionFields";

export function ModelSetupDialog({ onClose, onSaved }: {
  onClose: () => void;
  onSaved: (settings: Settings) => void;
}) {
  const [form, setForm] = useState<Settings | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    dialogRef.current?.showModal();
    let active = true;
    void api.getSettings().then((r) => { if (active) setForm(r.settings); })
      .catch(() => { if (active) setError("暂时无法读取设置，请关闭后重试。"); });
    return () => { active = false; };
  }, []);

  const save = async () => {
    if (!form || saving) return;
    setSaving(true);
    setError("");
    try {
      // 只覆盖连接字段,保留弹窗打开后在其他地方修改的设置。
      const result = await api.saveSettings({
        apiUrl: form.apiUrl.trim(), apiKey: form.apiKey.trim(), model: form.model.trim(),
      });
      onSaved(result.settings);
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存失败，请重试。");
    } finally { setSaving(false); }
  };

  return (
    <dialog ref={dialogRef}
      aria-labelledby="model-setup-title"
      onCancel={(e) => { e.preventDefault(); if (!saving) onClose(); }}
      className="m-auto w-[440px] max-w-[calc(100vw-32px)] max-h-[calc(100vh-32px)] overflow-y-auto rounded-2xl border border-border bg-surface p-0 text-text shadow-2xl backdrop:bg-black/25"
    >
      <form onSubmit={(e) => { e.preventDefault(); void save(); }} className="p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 id="model-setup-title" className="text-[20px] font-semibold tracking-tight">配置模型</h2>
            <p className="mt-1.5 text-[13px] leading-relaxed text-text-dim">填好连接信息，就可以开始这段对话。</p>
          </div>
          <button type="button" title="关闭" disabled={saving} onClick={onClose}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-text-faint hover:bg-bg-hover hover:text-text disabled:opacity-40"><X size={16} /></button>
        </div>
        {form ? <div className="mt-6 space-y-4">
          <ModelConnectionFields value={form} disabled={saving} autoFocus
            onChange={(key, value) => setForm({ ...form, [key]: value })} />
          <p className="text-[11.5px] leading-relaxed text-text-faint">支持 Responses 兼容接口。保存后可直接返回对话。</p>
        </div> : !error && <div className="py-10 text-center text-[13px] text-text-faint">正在读取设置…</div>}
        {error && <p role="alert" className="mt-4 break-words text-[12px] text-danger">{error}</p>}
        <button type="submit" disabled={!form?.apiUrl.trim() || !form?.model.trim() || saving}
          className="mt-6 flex w-full items-center justify-center gap-2 rounded-lg bg-accent px-4 py-2.5 text-[13px] font-medium text-white hover:opacity-90 disabled:opacity-40">
          {saving ? <><Loader2 size={15} className="animate-spin" />正在保存…</> : <>保存并返回对话<ArrowRight size={15} /></>}
        </button>
      </form>
    </dialog>
  );
}

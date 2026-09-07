// 「从浏览器导入」对话框。
//
// 为什么是对话框而不是设置页里的一行:这件事有**三个决定**要用户做 ——
// 从哪个 Chrome 配置导、导什么、以及知不知道后果。一行放不下,
// 而放不下的结果就是替用户默认(从前是自动挑最近用过的那个配置,多 Profile 的人没得选)。
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, Check, ChevronDown, Cookie, Loader, Star, X, Key } from "./icons";
import { Switch } from "./Switch";
import {
  importFromChrome, listChromeProfiles,
  type ChromeProfile, type ImportResult,
} from "../../lib/chromeImport";

export function ChromeImportDialog({ onClose, onDone }: {
  onClose: () => void;
  onDone?: (result: ImportResult) => void;
}) {
  const [profiles, setProfiles] = useState<ChromeProfile[]>([]);
  const [profile, setProfile] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [cookies, setCookies] = useState(true);
  const [bookmarks, setBookmarks] = useState(true);
  const [passwords, setPasswords] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    void listChromeProfiles().then((list) => {
      setProfiles(list);
      setProfile(list[0]?.dir || "");   // 默认选最近用过的那个
    });
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || busy) return;
      if (pickerOpen) setPickerOpen(false);
      else onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [busy, pickerOpen, onClose]);

  const current = profiles.find((p) => p.dir === profile);
  const nothingPicked = !cookies && !bookmarks && !passwords;

  const run = () => {
    if (busy || nothingPicked) return;
    setBusy(true);
    setError("");
    void importFromChrome({ profile, cookies, bookmarks, passwords })
      .then((result) => { onDone?.(result); onClose(); })
      .catch((e) => { setError(e?.message || "导入失败"); setBusy(false); });
  };

  // **必须 portal 到 body**:对话框原本渲染在设置面板的 DOM 里,祖先的 transform 会让
  // position:fixed 改锚到祖先、祖先的 stacking context 会把它压下去 —— 表现就是
  // 按钮点不动、点面板反而关掉。产品自己的 DialogHost 挂在 App 根上,天然没这个问题。
  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/25 px-4"
      onMouseDown={() => { if (!busy) onClose(); }}
    >
      {/* 遮罩收所有 mousedown,面板自己把事件截住 —— 与 Dialog.tsx 同一套路 */}
      <div
        className="w-full max-w-[440px] rounded-2xl border border-border bg-surface shadow-2xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3 px-6 pt-6 pb-4">
          <div className="flex-1 min-w-0">
            <h2 className="text-[19px] font-semibold text-text">从浏览器导入</h2>
            <p className="mt-1 text-[13px] text-text-faint">选择要导入到内置浏览器的数据</p>
          </div>
          <button onClick={onClose} disabled={busy}
            className="shrink-0 w-7 h-7 rounded-lg flex items-center justify-center text-text-faint
              hover:text-text hover:bg-bg-hover disabled:opacity-40 transition-colors">
            <X size={16} />
          </button>
        </div>

        {/* 从哪个配置导 —— 多 Profile 的人必须能选 */}
        <div className="px-6">
          <div className="flex items-center gap-3">
            <span className="shrink-0 text-[13px] text-text-dim">从</span>
            <div className="relative flex-1 min-w-0">
              <button
                onClick={() => setPickerOpen((v) => !v)}
                disabled={busy || profiles.length < 2}
                className="w-full flex items-center gap-2 h-11 px-3.5 rounded-xl border border-border
                  bg-bg text-left disabled:opacity-100 hover:bg-bg-hover transition-colors"
              >
                <ChromeMark />
                <span className="text-[14px] text-text truncate">Google Chrome</span>
                <span className="text-[13px] text-text-faint truncate">{current?.name || ""}</span>
                {profiles.length > 1 && <ChevronDown size={16} className="ml-auto shrink-0 text-text-faint" />}
              </button>

              {pickerOpen && (
                <div className="absolute left-0 right-0 top-full mt-1.5 z-10 rounded-xl border border-border
                  bg-surface shadow-xl overflow-hidden py-1">
                  {profiles.map((item) => (
                    <button key={item.dir}
                      onClick={() => { setProfile(item.dir); setPickerOpen(false); }}
                      className="w-full flex items-center gap-2 px-3.5 py-2.5 hover:bg-bg-hover transition-colors"
                    >
                      <ChromeMark />
                      <span className="text-[13.5px] text-text truncate">Google Chrome</span>
                      <span className="text-[12.5px] text-text-faint truncate">{item.name}</span>
                      {item.dir === profile && <Check size={14} className="ml-auto shrink-0 text-accent" />}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
          <p className="mt-2.5 text-[12.5px] text-text-faint">导入前,请完全关闭 Google Chrome</p>
        </div>

        {/* 导什么 */}
        <div className="mx-6 mt-4 rounded-xl border border-border overflow-hidden">
          <Row icon={<Cookie size={17} className="text-text-dim" />} label="登录状态(Cookie)"
            hint="导入后 AI 可在这些已登录的页面上执行操作"
            on={cookies} onChange={setCookies} disabled={busy} />
          <div className="h-px bg-border mx-3.5" />
          <Row icon={<Star size={17} className="text-text-dim" />} label="书签"
            hint="加入「网站」面板,已有的不重复添加"
            on={bookmarks} onChange={setBookmarks} disabled={busy} />
          <div className="h-px bg-border mx-3.5" />
          <Row icon={<Key size={17} className="text-text-dim" />} label="密码"
            hint="加入「网站」面板的密码页,加密保存在本机"
            on={passwords} onChange={setPasswords} disabled={busy} />
        </div>

        {error && (
          <div className="mx-6 mt-3 flex items-start gap-1.5 text-[12.5px] text-danger">
            <AlertTriangle size={13} className="shrink-0 mt-[2px]" />
            <span>{error}</span>
          </div>
        )}

        <div className="flex items-center justify-end gap-2.5 px-6 py-5">
          <button onClick={onClose} disabled={busy}
            className="h-10 px-5 rounded-xl bg-bg-inset text-[14px] text-text
              hover:bg-bg-hover disabled:opacity-40 transition-colors">
            取消
          </button>
          <button onClick={run} disabled={busy || nothingPicked}
            className="h-10 px-6 rounded-xl bg-text text-bg text-[14px] font-medium inline-flex items-center gap-2
              hover:opacity-90 disabled:opacity-40 transition-opacity">
            {busy && <Loader size={14} className="animate-spin" />}
            {busy ? "导入中…" : "导入"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function Row({ icon, label, hint, on, onChange, disabled }: {
  icon: React.ReactNode; label: string; hint: string;
  on: boolean; onChange: (v: boolean) => void; disabled: boolean;
}) {
  return (
    <div className="flex items-center gap-3 px-3.5 py-3">
      <span className="shrink-0">{icon}</span>
      <span className="flex-1 min-w-0">
        <span className="block text-[14px] text-text">{label}</span>
        <span className="block text-[11.5px] text-text-faint mt-0.5 leading-snug">{hint}</span>
      </span>
      <Switch on={on} onChange={onChange} label={label} disabled={disabled} />
    </div>
  );
}

/** Chrome 徽标:三段 120° 扇形(红上、绿右下、黄左下)+ 白环 + 蓝心。 */
const ChromeMark = () => (
  <svg width="18" height="18" viewBox="0 0 48 48" className="shrink-0" aria-hidden>
    <path fill="#EA4335" d="M6.68 14A20 20 0 0 1 41.32 14L24 24Z" />
    <path fill="#34A853" d="M41.32 14A20 20 0 0 1 24 44L24 24Z" />
    <path fill="#FBBC05" d="M24 44A20 20 0 0 1 6.68 14L24 24Z" />
    <circle cx="24" cy="24" r="10" fill="#fff" />
    <circle cx="24" cy="24" r="8.2" fill="#4285F4" />
  </svg>
);

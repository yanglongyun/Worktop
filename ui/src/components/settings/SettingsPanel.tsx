import { type Settings, settingsApi } from "../../api/settings";
import { type SkillInfo } from "../../api/skills";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { getThemePref, setThemePref, type ThemePref } from "../../lib/theme";
import { SEARCH_ENGINES, getSearchEngine, setSearchEngine, type SearchEngineId } from "../../lib/search";
import { chromeImportAvailable } from "../../lib/chromeImport";
import { Bot, Check, ExternalLink, Globe, Info, Loader, Settings as SettingsIcon, Sparkles, SlidersHorizontal } from "../ui/icons";
import { ChromeImportDialog } from "../ui";
import { ModelConnectionFields, settingsInputClass as inputClass } from "./ModelConnectionFields";
import { SkillsSettings } from "./SkillsSettings";

const emptySettings: Settings = {
  apiUrl: "", apiKey: "", model: "", system: "", compressThreshold: "64000",
  compactPrompt: "", toolResultMaxChars: "30000", toolRoundsLimit: "on", maxToolRounds: "64", telemetry: "on",
};
const categories = [
  { id: "model", label: "模型", icon: Bot, description: "连接模型，设置助手的回应方式。" },
  { id: "browser", label: "浏览器", icon: Globe, description: "管理搜索偏好、导入数据和网站状态。" },
  { id: "skills", label: "技能", icon: Sparkles, description: "点击技能名称，在新标签页阅读说明。" },
  { id: "general", label: "通用", icon: SettingsIcon, description: "让 Worktop 更符合你的使用习惯。" },
  { id: "advanced", label: "高级", icon: SlidersHorizontal, description: "调整长对话和工具结果的处理方式。" },
  { id: "about", label: "关于", icon: Info, description: "Worktop · 本地 AI 工作台" },
] as const;
type Category = typeof categories[number]["id"];
type SaveGroup = "connection" | "system" | "advanced" | "telemetry";
type SaveState = { busy?: boolean; error?: string; saved?: boolean };
const secondaryButton = "shrink-0 border border-border px-3 py-1.5 text-[12px] font-medium text-text transition-colors hover:bg-bg-hover disabled:opacity-40";

export function SettingsPanel({ onSaved, onOpenSkill }: { onSaved?: (settings: Settings) => void; onOpenSkill: (skill: SkillInfo) => void }) {
  const tabId = useId();
  const [category, setCategory] = useState<Category>("model");
  const [form, setForm] = useState<Settings>(emptySettings);
  const [baseline, setBaseline] = useState<Settings>(emptySettings);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [states, setStates] = useState<Partial<Record<SaveGroup, SaveState>>>({});
  const saving = useRef(new Set<SaveGroup>());
  const [theme, setTheme] = useState<ThemePref>(getThemePref);
  const [search, setSearch] = useState<SearchEngineId>(() => getSearchEngine().id);
  const [localNote, setLocalNote] = useState("");

  useEffect(() => {
    let active = true;
    setLoadError("");
    void settingsApi.getSettings().then(({ settings }) => {
      if (!active) return;
      const current = { ...emptySettings, ...settings };
      setForm(current); setBaseline(current); setLoaded(true);
    }).catch((e) => { if (active) setLoadError(e instanceof Error ? e.message : "无法读取设置"); });
    return () => { active = false; };
  }, [loadAttempt]);

  const edit = (key: keyof Settings, value: string, group: SaveGroup) => {
    setForm((current) => ({ ...current, [key]: value }));
    setStates((current) => ({ ...current, [group]: {} }));
  };
  const dirty = (keys: (keyof Settings)[]) => keys.some((key) => form[key] !== baseline[key]);
  const save = async (group: SaveGroup, patch: Partial<Settings>) => {
    if (saving.current.has(group)) return;
    saving.current.add(group);
    setStates((current) => ({ ...current, [group]: { busy: true } }));
    try {
      const { settings } = await settingsApi.saveSettings(patch);
      // 只同步本次保存的字段,其他分类尚未保存的草稿保持不变。
      const saved = Object.fromEntries(Object.keys(patch).map((key) => [key, settings[key as keyof Settings]]));
      setForm((current) => ({ ...current, ...saved }));
      setBaseline((current) => ({ ...current, ...saved }));
      setStates((current) => ({ ...current, [group]: { saved: true } }));
      onSaved?.(settings);
    } catch (e) {
      setStates((current) => ({ ...current, [group]: { error: e instanceof Error ? e.message : "保存失败，请重试。" } }));
    } finally { saving.current.delete(group); }
  };
  const selected = categories.find((item) => item.id === category)!;
  const connectionDirty = dirty(["apiUrl", "apiKey", "model"]);
  const advancedDirty = dirty(["compressThreshold", "toolResultMaxChars", "toolRoundsLimit", "maxToolRounds", "compactPrompt"]);

  return <div className="@container flex min-h-0 flex-1 flex-col bg-bg">
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 border-b border-border bg-surface">
        <nav role="tablist" aria-label="设置分类" className="mx-auto flex max-w-4xl overflow-x-auto px-8 @max-[640px]:px-3">
          {categories.map(({ id, label, icon: Icon }, index) => <button key={id} type="button"
            role="tab" id={`${tabId}-${id}`} aria-selected={category === id} aria-controls={`${tabId}-panel`} tabIndex={category === id ? 0 : -1}
            onClick={() => setCategory(id)}
            onKeyDown={(e) => {
              const next = e.key === "ArrowRight" ? (index + 1) % categories.length
                : e.key === "ArrowLeft" ? (index + categories.length - 1) % categories.length
                : e.key === "Home" ? 0 : e.key === "End" ? categories.length - 1 : null;
              if (next === null) return;
              e.preventDefault();
              setCategory(categories[next].id);
              e.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>("button")[next]?.focus();
            }}
            className={`flex shrink-0 items-center gap-2 border-b-2 px-4 py-3 text-[13px] transition-colors @max-[640px]:px-3 ${category === id ? "border-accent font-medium text-text" : "border-transparent text-text-dim hover:bg-bg-hover hover:text-text"}`}>
            <Icon size={14} /><span>{label}</span>
          </button>)}
        </nav>
      </div>
      <main role="tabpanel" id={`${tabId}-panel`} aria-labelledby={`${tabId}-${category}`} tabIndex={0} className="min-h-0 min-w-0 flex-1 overflow-y-auto outline-none">
        <div className="mx-auto max-w-4xl px-8 py-6 @max-[640px]:px-5 @max-[640px]:py-6">
          <header className="mb-4 border-b border-border pb-4"><h1 className="text-[17px] font-semibold text-text">{selected.label}</h1>
            <p className="mt-1.5 text-[12.5px] leading-relaxed text-text-faint">{selected.description}</p></header>
          {!loaded ? <div className="py-8 text-[13px] text-text-dim">{loadError ? <><p role="alert" className="mb-3 text-danger">{loadError}</p><button className={secondaryButton} onClick={() => setLoadAttempt((n) => n + 1)}>重新加载</button></> : "正在读取设置…"}</div> : <>
            <div hidden={category !== "model"} className="space-y-6">
              <Section title="模型连接" description="支持 Responses 兼容接口。">
                <form onSubmit={(e) => { e.preventDefault(); void save("connection", { apiUrl: form.apiUrl.trim(), apiKey: form.apiKey.trim(), model: form.model.trim() }); }}>
                  <ModelConnectionFields rows value={form} onChange={(key, value) => edit(key, value, "connection")} disabled={states.connection?.busy} />
                  <SaveFooter dirty={connectionDirty} state={states.connection} disabled={!form.apiUrl.trim() || !form.model.trim()} />
                </form>
              </Section>
              <Section title="助手指令" description="作为默认系统提示词，设定助手的语气、偏好与工作方式。">
                <form onSubmit={(e) => { e.preventDefault(); void save("system", { system: form.system }); }}>
                  <PromptEditor label="助手指令" name="system" value={form.system}
                    disabled={states.system?.busy} onChange={(value) => edit("system", value, "system")} />
                  <SaveFooter dirty={dirty(["system"])} state={states.system} />
                </form>
              </Section>
            </div>
            <div hidden={category !== "browser"} className="space-y-6">
              <Section title="浏览偏好"><Field label="搜索引擎" description="用于地址栏和新标签页中的搜索。">
                <select className={inputClass} value={search} onChange={(e) => { const value = e.target.value as SearchEngineId; setSearchEngine(value); setSearch(value); setLocalNote("search"); }}>
                  {SEARCH_ENGINES.map((engine) => <option key={engine.id} value={engine.id}>{engine.name}</option>)}
                </select>
              </Field>{localNote === "search" && <SavedNote />}</Section>
              <BrowserData />
            </div>
            {category === "skills" && <SkillsSettings onOpenSkill={onOpenSkill} />}
            <div hidden={category !== "general"} className="space-y-6">
              <Section title="外观"><Field label="主题">
                <select className={inputClass} value={theme} onChange={(e) => { const value = e.target.value as ThemePref; setThemePref(value); setTheme(value); setLocalNote("theme"); }}>
                  <option value="system">跟随系统</option><option value="light">浅色</option><option value="dark">深色</option>
                </select>
              </Field>{localNote === "theme" && <SavedNote />}</Section>
              <Section title="使用统计"><Field label="匿名使用统计" description="仅上报事件名、版本、平台与匿名安装 ID，用于了解使用情况。不包含对话、文件或网址内容。">
                <select className={inputClass} value={form.telemetry} disabled={states.telemetry?.busy}
                  onChange={(e) => { void save("telemetry", { telemetry: e.target.value }); }}>
                  <option value="on">开启</option><option value="off">关闭</option>
                </select>
              </Field><SaveFeedback state={states.telemetry} /></Section>
            </div>
            <div hidden={category !== "advanced"}>
              <Section title="上下文管理" description="通常保持默认值即可。">
                <form className="space-y-5" onSubmit={(e) => { e.preventDefault(); void save("advanced", { compressThreshold: form.compressThreshold, toolResultMaxChars: form.toolResultMaxChars, toolRoundsLimit: form.toolRoundsLimit, maxToolRounds: form.maxToolRounds, compactPrompt: form.compactPrompt }); }}>
                  <fieldset disabled={states.advanced?.busy} className="min-w-0 space-y-5">
                    <Field label="压缩阈值" description="对话达到此 token 数量时压缩历史内容。默认 64000，设为 0 关闭自动压缩。">
                      <input name="compressThreshold" className={inputClass} type="number" min={0} step={1} required value={form.compressThreshold} onChange={(e) => edit("compressThreshold", e.target.value, "advanced")} />
                    </Field>
                    <Field label="工具结果上限" description="单次工具结果保留的最多字符数。默认 30000，可设置为 1000–50000。">
                      <input name="toolResultMaxChars" className={inputClass} type="number" min={1000} max={50000} step={1} required value={form.toolResultMaxChars} onChange={(e) => edit("toolResultMaxChars", e.target.value, "advanced")} />
                    </Field>
                    <Field label="工具循环" description="一轮对话里工具调用的最多轮数，防止失控。关掉限制就一直跑到模型自己停下。">
                      <div className="flex items-center gap-2">
                        <select className={`${inputClass} cursor-pointer`} name="toolRoundsLimit" value={form.toolRoundsLimit} onChange={(e) => edit("toolRoundsLimit", e.target.value, "advanced")}>
                          <option value="on">最多</option>
                          <option value="off">不限制</option>
                        </select>
                        <input name="maxToolRounds" className={inputClass} type="number" disabled={form.toolRoundsLimit === "off"} min={1} max={1000} step={1} required value={form.maxToolRounds} onChange={(e) => edit("maxToolRounds", e.target.value, "advanced")} />
                        <span className="shrink-0 text-[12.5px] text-text-faint">轮</span>
                      </div>
                    </Field>
                    <div className="border-t border-border pt-4">
                      <h3 className="text-[13px] font-medium text-text">压缩提示词</h3>
                      <p className="mb-3 mt-2 text-[12px] leading-relaxed text-text-faint">控制历史对话如何被总结。</p>
                      <PromptEditor label="压缩提示词" name="compactPrompt" value={form.compactPrompt ?? ""}
                        disabled={states.advanced?.busy} onChange={(value) => edit("compactPrompt", value, "advanced")} />
                    </div>
                  </fieldset>
                  <SaveFooter dirty={advancedDirty} state={states.advanced} />
                </form>
              </Section>
            </div>
            <div hidden={category !== "about"}><Section title="Worktop">
              <div className="flex items-center justify-between text-[13px]"><span className="text-text-dim">当前版本</span><span className="text-text">{__APP_VERSION__}</span></div>
              <a href="https://github.com/yanglongyun/Worktop" target="_blank" rel="noreferrer" className="mt-5 inline-flex items-center gap-1.5 text-[13px] text-accent hover:underline">访问 GitHub 项目<ExternalLink size={13} /></a>
            </Section></div>
          </>}
        </div>
      </main>
    </div>
  </div>;
}

function PromptEditor({ label, name, value, disabled, onChange }: {
  label: string; name: string; value: string; disabled?: boolean; onChange: (value: string) => void;
}) {
  return <textarea aria-label={label} name={name} className={`${inputClass} min-h-32 resize-y leading-relaxed`} rows={5}
    value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)} />;
}

function Section({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return <section className="border-b border-border pb-6 last:border-b-0 last:pb-0"><h2 className="text-[13px] font-medium text-text">{title}</h2>
    {description && <p className="mt-1.5 text-[12px] leading-relaxed text-text-faint">{description}</p>}
    <div className="mt-4">{children}</div>
  </section>;
}
function Field({ label, description, children }: { label: string; description?: string; children: ReactNode }) {
  return <label className="grid grid-cols-[140px_minmax(0,1fr)] items-start gap-4 @max-[640px]:grid-cols-1 @max-[640px]:gap-2"><span className="pt-2 text-[12px] text-text-dim @max-[640px]:pt-0">{label}</span>
    <span className="min-w-0">{children}{description && <span className="mt-2 block text-[12px] leading-relaxed text-text-faint">{description}</span>}</span>
  </label>;
}
function SavedNote() { return <p role="status" className="mt-3 flex items-center gap-1.5 text-[12px] text-text-faint"><Check size={13} />已保存</p>; }
function SaveFeedback({ state }: { state?: SaveState }) {
  if (state?.error) return <p role="alert" className="mt-3 break-words text-[12px] text-danger">{state.error}</p>;
  if (state?.busy) return <p role="status" className="mt-3 text-[12px] text-text-faint">正在保存…</p>;
  return state?.saved ? <SavedNote /> : null;
}
function SaveFooter({ dirty, state, disabled }: { dirty: boolean; state?: SaveState; disabled?: boolean }) {
  return <><SaveFeedback state={state} />{dirty && <div className="mt-4 flex items-center justify-between gap-3">
    <span className="text-[12px] text-text-faint">有未保存的更改</span>
    <button type="submit" disabled={state?.busy || disabled} className="inline-flex items-center gap-1.5 bg-accent px-3 py-1.5 text-[12px] font-medium text-white hover:opacity-90 disabled:opacity-40">
      {state?.busy && <Loader size={13} className="animate-spin" />}{state?.busy ? "保存中…" : "保存更改"}
    </button>
  </div>}</>;
}

function BrowserData() {
  const [available, setAvailable] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [busy, setBusy] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState(false);
  useEffect(() => { void chromeImportAvailable().then(setAvailable).catch(() => setAvailable(false)); }, []);
  const run = async (key: string, action: () => Promise<string>) => {
    setBusy(key); setNote(""); setError(false);
    try { setNote(await action()); }
    catch (e) { setError(true); setNote(e instanceof Error ? e.message : "操作失败"); }
    finally { setBusy(""); }
  };
  const desktop = window.worktopDesktop;
  return <>
    {importOpen && <ChromeImportDialog onClose={() => setImportOpen(false)} onDone={(r) => {
      setError(false);
      setNote(`已从 ${r.profile} 导入 ${r.imported} 条登录信息${r.failed ? `，跳过 ${r.failed} 条` : ""}${r.bookmarks ? `，新增 ${r.bookmarks} 个网站` : ""}。刷新页面后生效。`);
    }} />}
    <Section title="导入数据"><ActionRow label="从 Chrome 导入" description={available ? "选择要导入的书签与登录数据。导入登录信息需通过系统钥匙串授权。" : "需要 macOS 上装有 Chrome。"}>
      <button className={secondaryButton} disabled={!available || !!busy} onClick={() => setImportOpen(true)}>从 Chrome 导入</button>
    </ActionRow></Section>
    <Section title="网站数据"><div className="space-y-5">
      <ActionRow label="缓存" description="释放磁盘空间，保留网站登录状态。"><button className={secondaryButton} disabled={!desktop || !!busy} onClick={() => void run("cache", async () => {
        const r = await desktop!.clearWebCache(); if (!r.ok) throw new Error(r.error || "清除失败"); return "缓存已清除";
      })}>{busy === "cache" ? "清除中…" : "清除缓存"}</button></ActionRow>
      <ActionRow label="登录状态" description="清除 Cookie 与站点数据，所有网站将退出登录。"><button className={secondaryButton} disabled={!desktop || !!busy} onClick={() => void run("logout", async () => {
        const r = await desktop!.clearWebLogins(); if (!r.ok) throw new Error(r.error || "清除失败"); return "已退出所有网站";
      })}>{busy === "logout" ? "退出中…" : "退出所有网站"}</button></ActionRow>
      <ActionRow label="网站权限" description="重置摄像头、麦克风、位置等授权及证书例外，下次访问时重新询问。"><button className={secondaryButton} disabled={!desktop || !!busy} onClick={() => void run("perm", async () => {
        await desktop!.forgetWebPermissions(); return "网站权限已重置";
      })}>{busy === "perm" ? "重置中…" : "重置网站权限"}</button></ActionRow>
    </div></Section>
    {note && <p role={error ? "alert" : "status"} className={`text-[12px] leading-relaxed ${error ? "text-danger" : "text-text-dim"}`}>{note}</p>}
  </>;
}
function ActionRow({ label, description, children }: { label: string; description: string; children: ReactNode }) {
  return <div className="flex items-center gap-5 @max-[640px]:flex-wrap @max-[640px]:gap-3">
    <div className="min-w-0 flex-1 @max-[640px]:basis-full"><div className="text-[13px] font-medium text-text">{label}</div><p className="mt-1 text-[12px] leading-relaxed text-text-faint">{description}</p></div>{children}
  </div>;
}

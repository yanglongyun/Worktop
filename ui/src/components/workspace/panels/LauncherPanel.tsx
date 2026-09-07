// 新标签页:一个大输入框 + 三种模式(对话 / 网址 / 命令)→ 最近对话 / 最近网站 / 应用。
// 不猜输入是什么:模式由框内左侧三个图标显式切换(⌘1/2/3、Tab),记住上次的模式。
// 网址卡里不是网址的就交给 Google(地址栏的老规矩);命令卡留空回车只开终端,输了命令就开终端并执行。
import { useEffect, useRef, useState } from "react";
import { Bot, Globe, Terminal } from "lucide-react";
import { api, type AppInfo, type HistoryEntry, type Node } from "../../../api";
import { Favicon } from "../../ui";
import type { LauncherTab, WorkspaceGroupId } from "../types";

type Mode = "chat" | "web" | "term";
const MODE_KEY = "worktop.launcher.mode";
const MODES: { id: Mode; label: string; icon: typeof Bot; placeholder: string; hint: string }[] = [
  { id: "chat", label: "对话", icon: Bot, placeholder: "想做什么?说一句,开新对话", hint: "↩ 开新对话" },
  { id: "web", label: "网址", icon: Globe, placeholder: "网址,或者要搜的东西", hint: "↩ 打开 / 搜索" },
  { id: "term", label: "命令", icon: Terminal, placeholder: "命令;留空回车只开终端", hint: "↩ 开终端" },
];
const readMode = (): Mode => {
  const v = localStorage.getItem(MODE_KEY);
  return v === "web" || v === "term" ? v : "chat";
};

const greeting = () => {
  const h = new Date().getHours();
  if (h < 5) return "夜深了";
  if (h < 9) return "早上好";
  if (h < 12) return "上午好";
  if (h < 14) return "中午好";
  if (h < 18) return "下午好";
  return "晚上好";
};

/** 预览行是给人扫一眼的,把 Markdown 记号剥干净。 */
const plainPreview = (text: string) =>
  text.replace(/```[\s\S]*?```/g, " ").replace(/[#*`>|_-]+/g, " ").replace(/\s+/g, " ").trim();

const hostOf = (url: string) => { try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return url; } };

const dateLine = () => {
  const now = new Date();
  return `${now.getMonth() + 1} 月 ${now.getDate()} 日 周${"日一二三四五六"[now.getDay()]}`;
};

export function LauncherPanel({ tab, groupId }: { tab: LauncherTab; groupId: WorkspaceGroupId }) {
  const [mode, setModeState] = useState<Mode>(readMode);
  const [value, setValue] = useState("");
  const [chats, setChats] = useState<Node[]>([]);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [apps, setApps] = useState<AppInfo[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { inputRef.current?.focus(); }, []);

  const setMode = (next: Mode) => {
    setModeState(next);
    localStorage.setItem(MODE_KEY, next);
    inputRef.current?.focus();
  };

  useEffect(() => {
    void api.listChats().then(({ chats }) => setChats(chats.filter((c) => c.kind === "chat").slice(0, 4))).catch(() => {});
    void api.listHistory().then((rows) => setHistory(rows.slice(0, 4))).catch(() => {});
    void api.listApps().then((list) => setApps(list.filter((a) => !a.invalid).slice(0, 12))).catch(() => {});
  }, []);

  const fire = (type: string, detail: Record<string, unknown> = {}) =>
    window.dispatchEvent(new CustomEvent(type, { detail: { tabId: tab.id, groupId, ...detail } }));

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") { e.preventDefault(); fire("worktop:launch", { value, kind: mode }); return; }
    if (e.key === "Escape") { e.preventDefault(); fire("worktop:launch-close"); return; }
    if (e.key === "Tab") {
      e.preventDefault();
      const i = MODES.findIndex((m) => m.id === mode);
      setMode(MODES[(i + (e.shiftKey ? MODES.length - 1 : 1)) % MODES.length].id);
      return;
    }
    if ((e.metaKey || e.ctrlKey) && !e.altKey && ["1", "2", "3"].includes(e.key)) {
      e.preventDefault();
      setMode(MODES[Number(e.key) - 1].id);
    }
  };

  const current = MODES.find((m) => m.id === mode)!;
  const rowClass = "flex items-center gap-2.5 text-left bg-surface border border-border rounded-[10px] px-3 py-2 hover:bg-bg-hover hover:border-border-strong transition-colors min-w-0";

  return (
    <div className="flex-1 min-h-0 overflow-y-auto bg-bg">
      <div className="max-w-[720px] mx-auto px-8 pt-14 pb-12 flex flex-col gap-7">
        {/* 问候 */}
        <div className="text-center">
          <div className="text-[22px] font-semibold tracking-tight text-text">{greeting()}</div>
          <div className="text-[12.5px] text-text-faint mt-0.5">{dateLine()}</div>
        </div>

        {/* 大框:左侧三个模式图标,提示语跟着变 */}
        <div>
          <div className="flex items-center gap-3 bg-surface border border-border-strong rounded-[14px] px-3.5 py-2.5 shadow-[0_2px_12px_rgba(0,0,0,0.04)] transition-colors focus-within:border-accent">
            <div className="shrink-0 flex gap-0.5 bg-bg-inset rounded-[9px] p-[3px]" role="tablist">
              {MODES.map((m, i) => (
                <button
                  key={m.id}
                  role="tab"
                  aria-selected={mode === m.id}
                  title={`${m.label} (⌘${i + 1})`}
                  onClick={() => setMode(m.id)}
                  className={[
                    "w-[30px] h-[26px] rounded-[7px] flex items-center justify-center transition-colors",
                    mode === m.id ? "bg-surface text-text shadow-[0_1px_2px_rgba(0,0,0,0.08)]" : "text-text-faint hover:text-text",
                  ].join(" ")}
                >
                  <m.icon size={14} />
                </button>
              ))}
            </div>
            <input
              ref={inputRef}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={onKey}
              placeholder={current.placeholder}
              spellCheck={false}
              autoComplete="off"
              className={[
                "flex-1 min-w-0 bg-transparent outline-none text-text placeholder:text-text-faint py-1",
                mode === "term" ? "font-mono text-[13.5px]" : "text-[15px]",
              ].join(" ")}
            />
            <span className="shrink-0 text-[11px] rounded px-1.5 py-0.5 select-none text-text-faint bg-bg-inset whitespace-nowrap">{current.hint}</span>
          </div>

        </div>

        {/* 最近对话 */}
        <div className="flex flex-col gap-2 min-w-0">
          <div className="text-[11px] text-text-faint tracking-[1.5px] select-none">最近对话</div>
          <div className="grid grid-cols-2 gap-2 max-md:grid-cols-1">
            {chats.map((c) => (
              <button key={c.id} onClick={() => fire("worktop:launch-open", { node: c })} className={rowClass}>
                <span className="shrink-0 text-[14px] leading-none">💬</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-medium text-text leading-[18px]">{c.title || "未命名对话"}</span>
                  <span className="block truncate text-[11.5px] text-text-faint leading-[16px]">{c.last?.text ? plainPreview(c.last.text) : ""}</span>
                </span>
              </button>
            ))}
          </div>
          {!chats.length && <div className="text-[12.5px] text-text-faint py-1">还没有对话,上面说一句就开工</div>}
        </div>

        {/* 最近网站 */}
        <div className="flex flex-col gap-2 min-w-0">
          <div className="text-[11px] text-text-faint tracking-[1.5px] select-none">最近网站</div>
          <div className="grid grid-cols-2 gap-2 max-md:grid-cols-1">
            {history.map((h) => (
              <button key={h.url} onClick={() => fire("worktop:launch", { value: h.url, kind: "web" })} title={h.url} className={rowClass}>
                <span className="shrink-0 w-[22px] h-[22px] rounded-md bg-bg-inset flex items-center justify-center"><Favicon url={h.url} size={14} /></span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-medium text-text leading-[18px]">{h.title || hostOf(h.url)}</span>
                  <span className="block truncate text-[11.5px] text-text-faint leading-[16px]">{hostOf(h.url)}</span>
                </span>
              </button>
            ))}
          </div>
          {!history.length && <div className="text-[12.5px] text-text-faint py-1">还没有浏览记录</div>}
        </div>

        {/* 应用 */}
        <div className="flex flex-col gap-2 min-w-0">
          <div className="text-[11px] text-text-faint tracking-[1.5px] select-none">应用</div>
          <div className="grid grid-cols-6 gap-2 max-md:grid-cols-4">
            {apps.map((a) => (
              <button
                key={a.id}
                onClick={() => fire("worktop:launch-app", { appId: a.id, name: a.name })}
                className="flex flex-col items-center gap-1.5 bg-surface border border-border rounded-[10px] px-1 py-2.5 text-[12px] text-text-dim hover:bg-bg-hover hover:border-border-strong hover:text-text transition-colors"
              >
                {a.hasIcon
                  ? <img src={`/api/apps/icon?id=${encodeURIComponent(a.id)}`} alt="" className="w-7 h-7 rounded-md" />
                  : <span className="w-7 h-7 rounded-md bg-bg-inset flex items-center justify-center text-[13px]">{Array.from(a.name)[0]}</span>}
                <span className="truncate max-w-full">{a.name}</span>
              </button>
            ))}
          </div>
          {!apps.length && <div className="text-[12.5px] text-text-faint py-1">还没有应用</div>}
        </div>
      </div>
    </div>
  );
}

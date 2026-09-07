// 右下角系统气泡:两类,同一叠放。
//   更新就绪 —— 壳广播 worktop:update-ready(electron-updater 下载完),点「重启更新」装上;
//   官方公告 —— api.worktop.iimos.ai 的 notices,启动拉一次 + 每 6 小时,看过的 id 记 localStorage。
// 都拿不到就安静,绝不打扰。
import { useEffect, useState } from "react";
import { ArrowUpCircle, Megaphone, X } from "./icons";

type Notice = { id: number; title: string; body: string; url: string };

const NOTICES_API = "https://api.worktop.iimos.ai/notices";
const SEEN_KEY = "worktop.seenNotices";

const seenIds = (): number[] => {
  try { return JSON.parse(localStorage.getItem(SEEN_KEY) || "[]"); } catch { return []; }
};
const markSeen = (id: number) => {
  try { localStorage.setItem(SEEN_KEY, JSON.stringify([...seenIds(), id].slice(-100))); } catch { /* 存不了拉倒 */ }
};

export function SystemNotices() {
  const [updateVersion, setUpdateVersion] = useState<string | null>(null);
  const [updateDismissed, setUpdateDismissed] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);

  useEffect(() => {
    const onReady = (e: Event) => {
      const version = String((e as CustomEvent).detail?.version || "");
      if (version) setUpdateVersion(version);
    };
    window.addEventListener("worktop:update-ready", onReady);
    return () => window.removeEventListener("worktop:update-ready", onReady);
  }, []);

  useEffect(() => {
    let stop = false;
    const load = async () => {
      try {
        const res = await fetch(`${NOTICES_API}?version=${encodeURIComponent(__APP_VERSION__)}`);
        const data = await res.json();
        if (stop) return;
        const seen = new Set(seenIds());
        setNotice((data?.notices || []).find((n: Notice) => !seen.has(n.id)) || null);
      } catch { /* 公告服务不通就不显示 */ }
    };
    load();
    const timer = setInterval(load, 6 * 60 * 60 * 1000);
    return () => { stop = true; clearInterval(timer); };
  }, []);

  const showUpdate = !!updateVersion && !updateDismissed;
  if (!showUpdate && !notice) return null;

  return (
    <div className="fixed bottom-4 right-4 z-40 flex w-[300px] flex-col gap-2">
      {notice && (
        <div className="rounded-lg border border-border bg-surface p-3 shadow-lg shadow-black/10">
          <div className="flex items-start gap-2">
            <Megaphone size={14} className="mt-0.5 shrink-0 text-accent" />
            <div className="min-w-0 flex-1">
              <div className="text-[13px] font-medium text-text">{notice.title}</div>
              {notice.body && (
                <div className="mt-0.5 text-[12px] leading-relaxed text-text-dim line-clamp-3">{notice.body}</div>
              )}
              {notice.url && (
                <a href={notice.url} target="_blank" rel="noreferrer" className="mt-1 inline-block text-[12px] text-accent hover:underline">
                  查看详情
                </a>
              )}
            </div>
            <button
              onClick={() => { markSeen(notice.id); setNotice(null); }}
              className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-text-faint hover:bg-bg-hover hover:text-text"
              title="知道了"
            >
              <X size={12} />
            </button>
          </div>
        </div>
      )}

      {showUpdate && (
        <div className="rounded-lg border border-border bg-surface p-3 shadow-lg shadow-black/10">
          <div className="flex items-center gap-2">
            <ArrowUpCircle size={14} className="shrink-0 text-success" />
            <div className="min-w-0 flex-1 truncate text-[13px] text-text">新版本 v{updateVersion} 已就绪</div>
            <button
              onClick={() => void window.worktopDesktop?.installUpdate()}
              className="h-6 shrink-0 rounded bg-accent px-2.5 text-[12px] text-white hover:opacity-90"
            >
              重启更新
            </button>
            <button
              onClick={() => setUpdateDismissed(true)}
              className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-text-faint hover:bg-bg-hover hover:text-text"
              title="稍后(退出时也会自动安装)"
            >
              <X size={12} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

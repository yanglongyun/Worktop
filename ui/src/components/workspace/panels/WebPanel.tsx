// 网页标签:Electron 壳里是真 <webview>(真会话、真登录态);
// 纯浏览器里没有这个标签,给一块诚实的兜底(日常站点普遍禁 iframe,不装能行)。
// 面板由 WorkspaceGroup 常驻挂载、CSS 控显隐 —— 卸载 = 断网重载,登录态全丢。
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, ChevronDown, ChevronUp, Download as DownloadIcon, ExternalLink, Globe, History, KeyRound, MoreHorizontal, RotateCw, Star, Trash2, X } from "lucide-react";
import type { WorkspaceGroupId, WebTab } from "../types";
import { api, type HistoryEntry } from "../../../api";
import { IN_ELECTRON, RE_REGISTER_EVENT, registerWebview, unregisterWebview } from "../../../lib/webviewHost";
import { displayUrl, hostKey, normalizeUrl } from "../../../lib/urls";
import { toNavigableUrl } from "../../../lib/search";
import { ChromeImportDialog } from "../../ui";
import { clearFinishedDownloads, progressText, useDownloads } from "../../../lib/downloads";
import {
  chromeImportAvailable,
  dismissImportPrompt,
  shouldPromptImport,
} from "../../../lib/chromeImport";

type Socket = {
  send: (m: any) => void;
  on: (t: string, fn: (p: any) => void) => () => void;
};

/** 网页标签的 session 分区。**必须与 desktop/main.js 的 WEB_PARTITION 一致** ——
 *  导入的登录态、「退出所有网站」都落在这个分区上,对不上就是各清各的。 */
const WEB_PARTITION = "persist:web";

export function WebPanel({ tab, socket, onUpdate, onFocus, groupId }: {
  tab: WebTab;
  socket: Socket;
  /** 必须是恒定引用(useCallback):注册 effect 依赖它,抖了 webview 会掉册。 */
  onUpdate: (id: string, patch: Partial<Pick<WebTab, "title" | "url" | "favicon">>) => void;
  /** 网页拿到焦点(用户在页面里点了)→ 激活它所在的半区。鼠标事件发生在 guest 里,宿主 DOM 看不见,只能靠 focus。 */
  onFocus?: (groupId: WorkspaceGroupId) => void;
  groupId?: WorkspaceGroupId;
}) {
  const viewRef = useRef<HTMLElement | null>(null);
  const wcIdRef = useRef<number | null>(null);
  useEffect(() => {
    const view = viewRef.current;
    if (!view || !onFocus || !groupId) return;
    const handler = () => onFocus(groupId);
    view.addEventListener("focus", handler);
    return () => view.removeEventListener("focus", handler);
  }, [onFocus, groupId]);
  // 平时展示人话形(藏 https:// 和尾斜杠),点进编辑时换完整 URL
  const [address, setAddress] = useState(displayUrl(tab.url));
  // <webview> 的 src 只在挂载时给一次。之后 tab.url 跟着页面自己的导航走(did-navigate 回写),
  // 如果 src 也跟着变,React 一改属性 webview 就再导航一次 —— 页面每跳一步我们就把它推回去一步,
  // 单页应用(阿里云控制台 / → /home/dashboard)会在两个地址之间无限来回。导航只走 loadURL / reload。
  const initialUrl = useRef(tab.url);
  const editing = useRef(false);
  const [loading, setLoading] = useState(false);
  const [starred, setStarred] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [downloadsOpen, setDownloadsOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyQuery, setHistoryQuery] = useState("");
  const [historyRows, setHistoryRows] = useState<HistoryEntry[]>([]);
  const downloads = useDownloads();
  const [zoom, setZoomState] = useState(0);
  const [finding, setFinding] = useState(false);
  const [needle, setNeedle] = useState("");
  const findRef = useRef<HTMLInputElement | null>(null);
  // 登录态引导:只在「能导 + 没导过/没关过」时出现,导完或关掉就不再来
  const [promptImport, setPromptImport] = useState(false);
  const [importNote, setImportNote] = useState("");
  const [importOpen, setImportOpen] = useState(false);

  // webview 事件:标题/地址跟着页面走,标签栏与地址栏同步;
  // 同时把自己登记为 browser 可操作的标签(本地注册表 + server 注册表)
  useEffect(() => {
    const view = viewRef.current as any;
    if (!view) return;
    const registerToServer = () => {
      if (wcIdRef.current == null) return;
      socket.send({
        type: "web_tab_register",
        wcId: wcIdRef.current,
        tabId: tab.id,
        url: view.getURL?.() || tab.url,
        title: tab.title,
        token: tab.token,
      });
    };
    const onDomReady = () => {
      try {
        const wcId = view.getWebContentsId?.();
        if (typeof wcId === "number") {
          wcIdRef.current = wcId;
          registerWebview(wcId, view, tab.id);
          registerToServer();
        }
      } catch { /* webview 还没 attach 好,下一次 dom-ready 再来 */ }
    };
    const onTitle = (e: any) => {
      if (!e.title) return;
      onUpdate(tab.id, { title: e.title });
      if (wcIdRef.current != null) socket.send({ type: "web_tab_update", wcId: wcIdRef.current, title: e.title });
    };
    const onNavigate = (e: any) => {
      if (!e.url) return;
      if (!editing.current) setAddress(displayUrl(e.url));
      onUpdate(tab.id, { url: e.url });
      if (wcIdRef.current != null) socket.send({ type: "web_tab_update", wcId: wcIdRef.current, url: e.url });
    };
    // 记一笔浏览记录。挂在 did-navigate 上不挂 in-page:页内锚点跳转不是「去过的地方」。
    // 标题这时可能还没到,history 那边会在下一次访问时补上。
    const onVisit = (e: any) => {
      if (e?.url) void api.noteVisit({ url: e.url, title: (view as any).getTitle?.() || "" });
    };
    const onStart = () => setLoading(true);
    const onStop = () => setLoading(false);
    const onFavicon = (e: any) => {
      const icon = Array.isArray(e.favicons) ? String(e.favicons[0] || "") : "";
      if (icon) onUpdate(tab.id, { favicon: icon }); // 页面自己上报的真实图标,标签栏优先用
    };
    view.addEventListener("dom-ready", onDomReady);
    view.addEventListener("page-favicon-updated", onFavicon);
    view.addEventListener("page-title-updated", onTitle);
    view.addEventListener("did-navigate", onNavigate);
    view.addEventListener("did-navigate", onVisit);
    view.addEventListener("did-navigate-in-page", onNavigate);
    view.addEventListener("did-start-loading", onStart);
    view.addEventListener("did-stop-loading", onStop);
    window.addEventListener(RE_REGISTER_EVENT, registerToServer); // server 重启后重新注册
    return () => {
      view.removeEventListener("dom-ready", onDomReady);
      view.removeEventListener("page-favicon-updated", onFavicon);
      view.removeEventListener("page-title-updated", onTitle);
      view.removeEventListener("did-navigate", onNavigate);
      view.removeEventListener("did-navigate", onVisit);
      view.removeEventListener("did-navigate-in-page", onNavigate);
      view.removeEventListener("did-start-loading", onStart);
      view.removeEventListener("did-stop-loading", onStop);
      window.removeEventListener(RE_REGISTER_EVENT, registerToServer);
      if (wcIdRef.current != null) {
        unregisterWebview(wcIdRef.current);
        socket.send({ type: "web_tab_unregister", wcId: wcIdRef.current });
        wcIdRef.current = null;
      }
    };
  }, [onUpdate, socket, tab.id]);

  const go = (target?: string) => {
    // 地址栏的老规矩:像网址就开,不像就交给设置里选的搜索引擎
    const url = target ? normalizeUrl(target) : toNavigableUrl(address);
    if (!url) return;
    editing.current = false;
    (viewRef.current as any)?.loadURL?.(url);
  };

  // 星标状态跟着地址走,也跟着「网站」面板的增删走(在面板里删掉,这里要熄灭)
  useEffect(() => {
    const key = hostKey(tab.url);
    const sync = () => {
      void api.listSites()
        .then((sites) => setStarred(!!key && sites.some((site) => hostKey(site.url) === key)))
        .catch(() => {});
    };
    sync();
    return socket.on("sites_changed", sync);
  }, [socket, tab.url]);

  // 引导条要不要出现:问一次壳(macOS + 装了 Chrome),再看本地状态
  useEffect(() => {
    if (!shouldPromptImport()) return;
    void chromeImportAvailable().then((ok) => setPromptImport(ok));
  }, []);

  // 开对话框:选哪个 Chrome 配置、导什么,由用户定 —— 这里只负责把它打开
  const runImport = useCallback(() => setImportOpen(true), []);

  // 历史面板:开着才拉,关键词变了重拉 —— 没打开时没必要为它查库
  useEffect(() => {
    if (!historyOpen) return;
    let gone = false;
    const timer = setTimeout(() => {
      void api.listHistory(historyQuery).then((rows) => { if (!gone) setHistoryRows(rows); }).catch(() => {});
    }, historyQuery ? 180 : 0); // 输入时防抖,首次打开立刻查
    return () => { gone = true; clearTimeout(timer); };
  }, [historyOpen, historyQuery]);

  // 证书例外刚加上:只有重载才会走一遍新的验证结果
  useEffect(() => {
    const onReload = (e: Event) => {
      const host = String((e as CustomEvent).detail?.host || "");
      if (!host || !tab.url.includes(host)) return;
      (viewRef.current as any)?.reload?.();
    };
    window.addEventListener("worktop:reload-web", onReload);
    return () => window.removeEventListener("worktop:reload-web", onReload);
  }, [tab.url]);

  // ⌘F 打开页内查找。挂在面板上而不是全局:多个网页标签常驻挂载,
  // 全局监听会让每个标签都抢一次快捷键 —— 只有可见的那个才响应。
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "f") {
        const host = viewRef.current?.parentElement;
        if (!host || host.offsetParent === null) return; // 这个标签当前不可见
        e.preventDefault();
        setFinding(true);
        setTimeout(() => findRef.current?.select(), 0);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const setZoom = (level: number) => {
    const next = Math.max(-3, Math.min(5, level));
    setZoomState(next);
    (viewRef.current as any)?.setZoomLevel?.(next);
  };

  const runFind = (text: string, forward = true) => {
    const view = viewRef.current as any;
    if (!view) return;
    if (!text) { view.stopFindInPage?.("clearSelection"); return; }
    view.findInPage?.(text, { forward, findNext: true });
  };

  const closeFind = () => {
    setFinding(false);
    setNeedle("");
    (viewRef.current as any)?.stopFindInPage?.("clearSelection");
  };

  const openExternal = () => window.open(tab.url, "_blank");

  // 收藏进「网站」面板。服务端按站点键去重,所以重复点不会插重复行;
  // 已收藏时星标点亮 —— 否则点下去毫无反馈,用户不知道成没成。
  const addToSites = () => {
    void api.createSite({ url: tab.url, title: tab.title }).then(() => setStarred(true)).catch(() => {});
  };

  if (!IN_ELECTRON) {
    return (
      <div className="flex-1 min-h-0 flex flex-col items-center justify-center gap-3 bg-bg px-6 text-center">
        <Globe size={28} className="text-text-faint" />
        <div className="text-[14px] text-text">网页标签需要在桌面壳(Electron)里打开</div>
        <div className="text-[12px] text-text-faint max-w-md truncate font-mono">{tab.url}</div>
        <button
          onClick={openExternal}
          className="mt-1 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-accent text-white text-[13px] hover:opacity-90 transition-opacity"
        >
          <ExternalLink size={13} /> 在浏览器打开
        </button>
      </div>
    );
  }

  const navBtn = "w-7 h-7 rounded flex items-center justify-center text-text-dim hover:text-text hover:bg-bg-hover transition-colors disabled:opacity-30";
  const menuItem = "w-full flex items-center justify-between gap-3 px-3 py-1.5 text-left text-text hover:bg-bg-hover transition-colors";
  const menuDiv = "my-1 border-t border-border";
  const kbd = "text-[11px] text-text-faint font-mono";
  const zoomBtn = "w-5 h-5 rounded flex items-center justify-center text-text-dim hover:text-text hover:bg-bg-hover transition-colors";

  return (
    <div className="flex-1 min-h-0 flex flex-col bg-bg">
      {/* 工具栏:后退 / 前进 / 刷新 / 地址 / 收藏 / 系统浏览器 */}
      <div className="shrink-0 flex items-center gap-1 px-2 py-1.5 border-b border-border bg-bg-raised/60">
        <button className={navBtn} title="后退" onClick={() => (viewRef.current as any)?.goBack?.()}><ArrowLeft size={14} /></button>
        <button className={navBtn} title="前进" onClick={() => (viewRef.current as any)?.goForward?.()}><ArrowRight size={14} /></button>
        <button className={navBtn} title="刷新" onClick={() => (viewRef.current as any)?.reload?.()}>
          <RotateCw size={13} className={loading ? "animate-spin" : ""} />
        </button>
        <input
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          onFocus={(e) => {
            // 编辑态换完整 URL(要精确就给全文),值换完再全选
            editing.current = true;
            setAddress(tab.url);
            const el = e.target as HTMLInputElement;
            requestAnimationFrame(() => el.select());
          }}
          onBlur={() => { editing.current = false; setAddress(displayUrl(tab.url)); }}
          onKeyDown={(e) => {
            if (e.key === "Enter") { go(); (e.target as HTMLInputElement).blur(); }
            if (e.key === "Escape") { editing.current = false; setAddress(displayUrl(tab.url)); (e.target as HTMLInputElement).blur(); }
          }}
          spellCheck={false}
          className="flex-1 min-w-0 h-7 px-2.5 rounded-md border border-border bg-surface text-[12.5px] font-mono text-text-dim focus:text-text focus:border-accent outline-none transition-colors"
        />
        <button
          className={starred ? `${navBtn} text-accent hover:text-accent` : navBtn}
          title={starred ? "已在「网站」面板" : "添加到「网站」面板"}
          onClick={addToSites}
        >
          <Star size={13} fill={starred ? "currentColor" : "none"} />
        </button>

        {/* 浏览记录:紧跟收藏。收藏是「我要再来」,记录是「我来过」—— 同一类动作,该挨着 */}
        <div className="relative">
          <button
            className={historyOpen ? `${navBtn} text-text bg-bg-hover` : navBtn}
            title="浏览记录"
            onClick={(e) => { e.stopPropagation(); setHistoryOpen((open) => !open); setHistoryQuery(""); }}
          >
            <History size={13} />
          </button>
          {historyOpen && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setHistoryOpen(false)} />
              <div className="absolute top-full right-0 mt-1 z-50 w-[360px] rounded-lg border border-border bg-bg-raised shadow-lg overflow-hidden">
                <div className="flex items-center gap-2 px-2.5 py-2 border-b border-border">
                  <input
                    autoFocus
                    value={historyQuery}
                    onChange={(e) => setHistoryQuery(e.target.value)}
                    placeholder="搜索浏览记录…"
                    className="flex-1 min-w-0 h-7 px-2 rounded-md border border-border bg-bg text-[12.5px] text-text placeholder:text-text-faint outline-none focus:border-accent"
                  />
                  {historyRows.length > 0 && (
                    <button
                      className="shrink-0 text-[11.5px] text-text-faint hover:text-danger transition-colors"
                      onClick={() => { void api.forgetHistory({ all: true }).then(() => setHistoryRows([])); }}
                    >
                      清空
                    </button>
                  )}
                </div>
                <div className="max-h-[320px] overflow-y-auto py-1">
                  {historyRows.map((row) => (
                    <div key={row.url} className="group flex items-center gap-2 px-2.5 py-1.5 hover:bg-bg-hover transition-colors">
                      <button
                        className="min-w-0 flex-1 text-left"
                        onClick={() => { setHistoryOpen(false); go(row.url); }}
                      >
                        <div className="truncate text-[12.5px] text-text">{row.title || row.url}</div>
                        <div className="truncate text-[11px] text-text-faint">{displayUrl(row.url)}</div>
                      </button>
                      <button
                        title="从记录中删除"
                        className="shrink-0 w-5 h-5 rounded flex items-center justify-center text-text-faint opacity-0 group-hover:opacity-100 hover:text-danger transition-all"
                        onClick={() => {
                          void api.forgetHistory({ url: row.url })
                            .then(() => setHistoryRows((rows) => rows.filter((r) => r.url !== row.url)));
                        }}
                      >
                        <Trash2 size={11} />
                      </button>
                    </div>
                  ))}
                  {!historyRows.length && (
                    <div className="px-3 py-6 text-center text-[12px] text-text-faint">
                      {historyQuery ? "没有匹配的记录" : "还没有浏览记录"}
                    </div>
                  )}
                </div>
              </div>
            </>
          )}
        </div>
        {/* 下载胶囊:有下载才出现。文件已经落到磁盘上了,不给个入口用户找不到 */}
        {downloads.length > 0 && (
          <div className="relative">
            <button
              className={[
                "shrink-0 inline-flex items-center gap-1.5 h-7 px-2 rounded-md text-[12px] transition-colors",
                downloads[0].state === "progressing" ? "text-accent bg-accent/10 hover:bg-accent/[0.16]"
                  : downloads[0].state === "completed" ? "text-success bg-success/10 hover:bg-success/[0.16]"
                    : "text-danger bg-danger/10 hover:bg-danger/[0.16]",
              ].join(" ")}
              title="下载内容"
              onClick={(e) => { e.stopPropagation(); setDownloadsOpen((open) => !open); }}
            >
              <DownloadIcon size={13} />
              <span className="tabular-nums">{progressText(downloads[0])}</span>
            </button>
            {downloadsOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setDownloadsOpen(false)} />
                <div className="absolute top-full right-0 mt-1 z-50 w-72 py-1 rounded-lg border border-border bg-bg-raised shadow-lg">
                  <div className="flex items-center justify-between px-3 py-1.5 text-[11px] text-text-faint">
                    <span>下载内容</span>
                    {downloads.some((d) => d.state !== "progressing") && (
                      <button className="hover:text-text transition-colors" onClick={clearFinishedDownloads}>清空</button>
                    )}
                  </div>
                  {downloads.map((item) => (
                    <div key={item.id} className="group flex items-center gap-2 px-3 py-1.5 hover:bg-bg-hover transition-colors">
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[12.5px] text-text">{item.name}</div>
                        <div className="text-[11px] text-text-faint tabular-nums">{progressText(item)}</div>
                      </div>
                      {item.state === "progressing" ? (
                        <button
                          className="shrink-0 text-[11.5px] text-text-faint hover:text-danger transition-colors"
                          onClick={() => void window.worktopDesktop?.cancelDownload(item.id)}
                        >
                          取消
                        </button>
                      ) : item.state === "completed" && (
                        <span className="shrink-0 flex items-center gap-2 text-[11.5px] text-text-faint">
                          <button className="hover:text-text transition-colors"
                            onClick={() => void window.worktopDesktop?.openDownload(item.path)}>打开</button>
                          <button className="hover:text-text transition-colors"
                            onClick={() => void window.worktopDesktop?.revealDownload(item.path)}>显示</button>
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        )}

        {/* 菜单挂在**触发它的这一行**里(relative 容器 + top-full):
            挂到外面就要拿行高硬算坐标,行高一改就错位 */}
        <div className="relative">
          <button
            className={menuOpen ? `${navBtn} text-text bg-bg-hover` : navBtn}
            title="更多"
            onClick={(e) => { e.stopPropagation(); setMenuOpen((open) => !open); }}
          >
            <MoreHorizontal size={15} />
          </button>
          {menuOpen && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} />
              <div className="absolute top-full right-0 mt-1 z-50 w-56 py-1 rounded-lg border border-border bg-bg-raised shadow-lg text-[13px]">
                {/* 登录态排第一 —— 它是这个浏览器能不能用起来的前提,不是杂项 */}
                <button className={menuItem} onClick={() => { setMenuOpen(false); runImport(); }}>
                  <span className="flex items-center gap-2"><KeyRound size={13} /> 导入 Chrome 登录状态</span>
                </button>
                <div className={menuDiv} />
                <button className={menuItem} onClick={() => { setMenuOpen(false); setFinding(true); setTimeout(() => findRef.current?.focus(), 0); }}>
                  页内查找<kbd className={kbd}>⌘F</kbd>
                </button>
                <div className="flex items-center justify-between px-3 py-1.5 text-text-dim">
                  <span>缩放</span>
                  <span className="flex items-center gap-1.5">
                    <button className={zoomBtn} onClick={() => setZoom(zoom - 0.5)}>−</button>
                    <b className="w-10 text-center text-[12px] tabular-nums text-text">{Math.round(1.2 ** zoom * 100)}%</b>
                    <button className={zoomBtn} onClick={() => setZoom(zoom + 0.5)}>+</button>
                  </span>
                </div>
                <div className={menuDiv} />
                <button className={menuItem} onClick={() => { setMenuOpen(false); void navigator.clipboard.writeText(tab.url).catch(() => {}); }}>
                  复制链接
                </button>
                <button className={menuItem} onClick={() => { setMenuOpen(false); openExternal(); }}>
                  在系统浏览器打开
                </button>
                <div className={menuDiv} />
                <button className={menuItem} onClick={() => { setMenuOpen(false); (viewRef.current as any)?.openDevTools?.(); }}>
                  开发者工具
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      {importOpen && (
        <ChromeImportDialog
          onClose={() => setImportOpen(false)}
          onDone={(r) => {
            setPromptImport(false);
            setImportNote(
              `已从 ${r.profile} 导入 ${r.imported} 条登录信息` +
              `${r.failed ? `,跳过 ${r.failed} 条` : ""}` +
              `${r.bookmarks ? `,新增 ${r.bookmarks} 个网站` : ""}${r.passwords ? `,导入 ${r.passwords} 条密码` : ""}。刷新页面后生效。`,
            );
          }}
        />
      )}

      {/* 登录态引导:痛点就在这块面板里 —— 打开的站没登录,提示就该长在这儿,
          而不是等用户自己翻到设置页去找 */}
      {promptImport && (
        <div className="shrink-0 flex items-start gap-2.5 px-3 py-2 border-b border-border bg-accent/[0.06]">
          <KeyRound size={14} className="mt-0.5 shrink-0 text-accent" />
          <div className="min-w-0 flex-1">
            <div className="text-[12.5px] text-text">导入 Chrome 登录状态</div>
            <div className="mt-0.5 text-[11.5px] text-text-faint leading-relaxed">
              导入登录状态与书签,可选择 Chrome 配置。导入登录信息需通过系统钥匙串授权。
            </div>
          </div>
          <button
            onClick={runImport}
            className="shrink-0 px-2.5 py-1 rounded-md bg-accent text-white text-[12px] hover:opacity-90 disabled:opacity-50 transition-opacity"
          >
            导入…
          </button>
          <button
            onClick={() => { dismissImportPrompt(); setPromptImport(false); }}
            className="shrink-0 w-6 h-6 rounded flex items-center justify-center text-text-faint hover:text-text hover:bg-bg-hover transition-colors"
            title="不再提示"
          >
            <X size={13} />
          </button>
        </div>
      )}

      {importNote && !promptImport && (
        <div className="shrink-0 flex items-center gap-2 px-3 py-1.5 border-b border-border bg-bg-raised/60 text-[12px] text-text-dim">
          <span className="min-w-0 flex-1 truncate">{importNote}</span>
          <button className={navBtn} title="关闭" onClick={() => setImportNote("")}><X size={12} /></button>
        </div>
      )}

      {finding && (
        <div className="shrink-0 flex items-center gap-1 px-2 py-1.5 border-b border-border bg-bg-raised/60">
          <input
            ref={findRef}
            value={needle}
            onChange={(e) => { setNeedle(e.target.value); runFind(e.target.value); }}
            onKeyDown={(e) => {
              if (e.key === "Enter") runFind(needle, !e.shiftKey);
              if (e.key === "Escape") closeFind();
            }}
            placeholder="页内查找"
            className="flex-1 min-w-0 h-7 px-2.5 rounded-md border border-border bg-surface text-[12.5px] text-text outline-none focus:border-accent transition-colors"
          />
          <button className={navBtn} title="上一个" onClick={() => runFind(needle, false)}><ChevronUp size={14} /></button>
          <button className={navBtn} title="下一个" onClick={() => runFind(needle, true)}><ChevronDown size={14} /></button>
          <button className={navBtn} title="关闭" onClick={closeFind}><X size={14} /></button>
        </div>
      )}

      {/* allowpopups 必须开:不开的话 window.open 与 target=_blank 连事件都不产生,
          点 Google 搜索结果就是「没反应」。开了之后由主进程的 setWindowOpenHandler
          决定去处 —— 带尺寸的弹窗真开窗口(OAuth 要),其余落我们自己的新标签。 */}
      <webview
        ref={(el) => { viewRef.current = el; }}
        src={initialUrl.current}
        partition={WEB_PARTITION}
        allowpopups={"true" as unknown as boolean}
        preload={window.worktopDesktop?.webviewPreload || undefined}
        allowFullScreen
        className="flex-1 min-h-0"
        style={{ display: "flex" }}
      />
    </div>
  );
}

import { type HistoryEntry, type PasswordEntry, type Bookmark, browserApi } from "../../../api/browser";
// 「网站」段:收藏 / 历史 / 密码 三个子视图。点开即在网页标签里打开(Electron 壳的 <webview>,真登录态)。
// 收藏(server/sites):一棵树,文件夹可以无限嵌套,同级可拖动排序。
// 历史:一个 url 一行,重复访问只抬时间与次数。
// 密码:按网站存的账号密码,宿主加密落库,明文只在点开那一刻解。
//
// 骨架:子视图切换 → 工具行(搜索 + ＋ + ⋯,只作用于当前子视图)→ 列表。
// 行 = 图标 · 主文字 · 右侧灰字,悬停出两个快捷动作,其余右键。密码点行 = 打开网站,编辑在行下就地展开。
//
// 拖拽用指针事件,和标签栏同一套路:超阈值才算拖、挂 lib/drag.ts 的
// 全局护栏(webview/iframe 会吞 pointerup)、松手事件被吞时靠 buttons===0 自愈。
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronRight, ChevronsDownUp, ChevronsUpDown, Download, Eye, EyeOff, Folder, FolderPlus, Globe, History, Key, Pencil, Plus, Star, Pin, PinOff, Trash, Upload, User, X } from "../../ui/icons";
import { isPinned, togglePin } from "../../../lib/railPins";
import { beginGlobalDrag, endGlobalDrag } from "../../../lib/drag";
import { ChromeImportDialog, ContextMenu, dialog, showToast, type MenuItem } from "../../ui";
import { Toolbar } from "../Toolbar";
import { PanelEmptyState } from "./PanelEmptyState";

const hostOf = (url: string) => { try { return new URL(url).host; } catch { return url; } };
const OPEN_KEY = "worktop.sites.openFolders";
const VIEW_KEY = "worktop.sites.view";
type View = "sites" | "history" | "passwords";
const readOpen = (): string[] => {
  try { return JSON.parse(localStorage.getItem(OPEN_KEY) || "[]"); } catch { return []; }
};
const readView = (): View => {
  try { const v = localStorage.getItem(VIEW_KEY); return v === "history" || v === "passwords" ? v : "sites"; } catch { return "sites"; }
};

const ago = (at: string) => {
  const t = new Date(at.replace(" ", "T") + "Z").getTime();
  const ms = Date.now() - t;
  if (!Number.isFinite(ms)) return at;
  if (ms < 60_000) return "刚刚";
  if (ms < 3600_000) return `${Math.round(ms / 60_000)} 分钟前`;
  if (ms < 86400_000) return `${Math.round(ms / 3600_000)} 小时前`;
  return `${Math.round(ms / 86400_000)} 天前`;
};
const dayLabel = (at: string) => {
  const d = new Date(at.replace(" ", "T") + "Z");
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const diff = Math.floor((today.getTime() - new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()) / 86400_000);
  if (diff <= 0) return "今天";
  if (diff === 1) return "昨天";
  return `${d.getMonth() + 1} 月 ${d.getDate()} 日`;
};

type Drop = { overId: string; where: "before" | "after" | "inside" } | null;

const Favicon = ({ url }: { url: string }) => (
  <img
    src={`/api/browser/favicon?url=${encodeURIComponent(url)}`}
    alt=""
    className="shrink-0 w-4 h-4 rounded-[3px] object-contain"
    onError={(e) => { (e.currentTarget as HTMLImageElement).style.visibility = "hidden"; }}
  />
);

const actionBtn = "shrink-0 w-5 h-5 rounded flex items-center justify-center text-text-faint opacity-0 group-hover:opacity-100 hover:text-text hover:bg-bg-inset";

export function SitesPanel({ onOpenUrl, socket }: {
  onOpenUrl: (url: string, title?: string) => void;
  socket: { on: (event: string, fn: (payload: unknown) => void) => () => void };
}) {
  const [sites, setSites] = useState<Bookmark[]>([]);
  const [sitesLoaded, setSitesLoaded] = useState(false);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [hits, setHits] = useState<HistoryEntry[]>([]);
  const [passwords, setPasswords] = useState<PasswordEntry[]>([]);
  const [view, setView] = useState<View>(() => readView());
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);
  const [open, setOpen] = useState<Set<string>>(() => new Set(readOpen()));
  const [dragId, setDragId] = useState<string | null>(null);
  const [drop, setDrop] = useState<Drop>(null);
  const [q, setQ] = useState("");
  const listRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ id: string; startY: number; dragging: boolean; drop: Drop } | null>(null);
  const suppressClick = useRef(false);

  const load = useCallback(() => { void browserApi.listBookmarks().then((rows) => { setSites(rows); setSitesLoaded(true); }).catch(() => {}); }, []);
  const loadHistory = useCallback(() => { void browserApi.listHistory().then(setHistory).catch(() => {}); }, []);
  const loadPasswords = useCallback(() => { void browserApi.listPasswords().then(setPasswords).catch(() => {}); }, []);
  useEffect(() => { load(); loadHistory(); loadPasswords(); }, [load, loadHistory, loadPasswords]);
  useEffect(() => socket.on("sites_changed", () => load()), [socket, load]);
  useEffect(() => socket.on("history_changed", () => loadHistory()), [socket, loadHistory]);
  useEffect(() => socket.on("passwords_changed", () => loadPasswords()), [socket, loadPasswords]);
  const switchView = (next: View) => {
    setView(next);
    setQ("");
    setPwEditing(null);
    try { localStorage.setItem(VIEW_KEY, next); } catch { /* 隐私模式 */ }
  };

  const needle = q.trim().toLowerCase();
  useEffect(() => {
    if (!needle || view !== "history") { setHits([]); return; }
    let gone = false;
    const timer = setTimeout(() => { void browserApi.listHistory(q.trim()).then((rows) => { if (!gone) setHits(rows); }).catch(() => {}); }, 180);
    return () => { gone = true; clearTimeout(timer); };
  }, [needle, q, view]);

  const byId = useMemo(() => new Map(sites.map((s) => [s.id, s])), [sites]);
  const childrenOf = (id: string | null) => sites.filter((s) => (s.parent_id || null) === id);
  const isWithin = (target: string | null, folderId: string) => {
    let cur = target;
    for (let i = 0; cur && i < 64; i++) { if (cur === folderId) return true; cur = byId.get(cur)?.parent_id || null; }
    return false;
  };
  const pathOf = (site: Bookmark) => {
    const names: string[] = [];
    let cur = site.parent_id;
    for (let i = 0; cur && i < 64; i++) { const p = byId.get(cur); if (!p) break; names.unshift(p.title); cur = p.parent_id; }
    return names.join(" / ");
  };
  const bookmarked = useMemo(() => new Set(sites.filter((s) => s.kind === "site").map((s) => s.url.replace(/\/$/, ""))), [sites]);
  const folderIds = useMemo(() => sites.filter((s) => s.kind === "folder").map((s) => s.id), [sites]);

  const writeOpen = (next: Set<string>) => {
    try { localStorage.setItem(OPEN_KEY, JSON.stringify([...next])); } catch { /* 隐私模式 */ }
    return next;
  };
  const toggleFolder = (id: string) => {
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return writeOpen(next);
    });
  };
  const expandAll = () => setOpen(writeOpen(new Set(folderIds)));
  const collapseAll = () => setOpen(writeOpen(new Set()));

  // ── 收藏 ──
  // 添加网站 = 就地展开一张空表单(名称 + 网址),在目标文件夹(或根)的最上面
  const add = (parentId: string | null = null) => {
    setSiteEditing({ id: null, kind: "site", title: "", url: "", parentId });
    if (parentId) setOpen((o) => { const n = new Set(o); n.add(parentId); return n; });
  };
  const addFolder = async (parentId: string | null = null) => {
    const title = await dialog.prompt("", { title: "新建文件夹", placeholder: "文件夹名…", confirmText: "创建" });
    if (!title || !title.trim()) return;
    try { await browserApi.createBookmarkFolder({ title: title.trim(), parentId }); if (parentId) setOpen((p) => writeOpen(new Set(p).add(parentId))); load(); }
    catch (e: any) { void dialog.alert(e?.message || "创建失败"); }
  };
  const remove = async (site: Bookmark) => {
    const isFolder = site.kind === "folder";
    // 整棵子树里有多少条收藏(不算文件夹本身)
    let count = 0;
    if (isFolder) {
      const stack = [site.id];
      while (stack.length) for (const c of childrenOf(stack.pop()!)) { if (c.kind === "folder") stack.push(c.id); else count++; }
    }
    const hint = isFolder ? (count ? `\n里面的 ${count} 条收藏会一起删除,不可恢复。` : "\n它是空的。") : "";
    if (!(await dialog.confirm(`${isFolder ? "删除文件夹" : "从收藏里移除"}「${site.title}」?${hint}`,
      { danger: true, confirmText: isFolder ? "删除" : "移除" }))) return;
    try { await browserApi.removeBookmark(site.id); load(); } catch { /* 列表会自己对齐 */ }
  };
  const siteInputClass = "w-full h-7 px-2 border border-border bg-bg text-[12.5px] text-text placeholder:text-text-faint outline-none focus:border-accent";
  // 编辑在行下就地展开:网站改名字 + 网址,文件夹只改名字
  // id 为 null = 新建(parentId 说明放哪);否则是编辑已有的一条
  const [siteEditing, setSiteEditing] = useState<{ id: string | null; kind: Bookmark["kind"]; title: string; url: string; parentId?: string | null } | null>(null);
  const editSite = (site: Bookmark) => setSiteEditing({ id: site.id, kind: site.kind, title: site.title, url: site.url });
  const saveSite = async () => {
    if (!siteEditing) return;
    const title = siteEditing.title.trim();
    const url = siteEditing.url.trim();
    if (siteEditing.kind === "site" && !url) { void dialog.alert("网址不能为空"); return; }
    try {
      if (siteEditing.id === null) await browserApi.createBookmark({ url, title: title || undefined, parentId: siteEditing.parentId ?? null });
      else await browserApi.updateBookmark(siteEditing.id, siteEditing.kind === "site" ? { title, url } : { title });
      setSiteEditing(null);
      load();
    } catch (e: any) { void dialog.alert(e?.message || (siteEditing.id === null ? "添加失败" : "保存失败")); }
  };
  const contextMenu = (e: React.MouseEvent, site: Bookmark) => {
    e.preventDefault(); e.stopPropagation();
    const isFolder = site.kind === "folder";
    setMenu({
      x: e.clientX, y: e.clientY,
      items: [
        ...(isFolder
          ? [
            { label: "在此添加网站…", icon: <Plus size={13} />, onClick: () => add(site.id) },
            { label: "在此新建文件夹…", icon: <FolderPlus size={13} />, onClick: () => void addFolder(site.id) },
          ]
          : [
            { label: "打开", icon: <Globe size={13} />, onClick: () => onOpenUrl(site.url, site.title) },
            { label: isPinned("site", site.id) ? "从活动栏取消固定" : "固定到活动栏",
              icon: isPinned("site", site.id) ? <PinOff size={13} /> : <Pin size={13} />,
              onClick: () => { togglePin({ kind: "site", id: site.id, title: site.title || hostOf(site.url), url: site.url }); } },
          ]),
        { label: isFolder ? "重命名" : "编辑", icon: <Pencil size={13} />, onClick: () => editSite(site) },
        "divider" as const,
        { label: isFolder ? "删除文件夹" : "移除", icon: <Trash size={13} />, danger: true, onClick: () => void remove(site) },
      ],
    });
  };

  // ── 历史 ──
  const bookmark = async (h: HistoryEntry) => {
    try { await browserApi.createBookmark({ url: h.url, title: h.title || undefined }); load(); } catch (e: any) { void dialog.alert(e?.message || "收藏失败"); }
  };
  const forget = async (h: HistoryEntry) => {
    try { await browserApi.forgetHistory({ url: h.url }); loadHistory(); if (needle) setHits((rows) => rows.filter((r) => r.url !== h.url)); } catch { /* 同上 */ }
  };
  const clearHistory = async () => {
    if (!history.length) return;
    if (!(await dialog.confirm("清空全部浏览记录?不可恢复。", { danger: true, confirmText: "清空" }))) return;
    try { await browserApi.forgetHistory({ all: true }); loadHistory(); setHits([]); } catch { /* 同上 */ }
  };
  const historyMenu = (e: React.MouseEvent, h: HistoryEntry) => {
    e.preventDefault(); e.stopPropagation();
    const saved = bookmarked.has(h.url.replace(/\/$/, ""));
    setMenu({
      x: e.clientX, y: e.clientY,
      items: [
        { label: "打开", icon: <Globe size={13} />, onClick: () => onOpenUrl(h.url, h.title) },
        { label: saved ? "已在收藏里" : "收藏", icon: <Star size={13} />, disabled: saved, onClick: () => void bookmark(h) },
        "divider" as const,
        { label: "从历史里删除", icon: <Trash size={13} />, danger: true, onClick: () => void forget(h) },
      ],
    });
  };

  // ── 密码 ──
  const [pwEditing, setPwEditing] = useState<{ id: string | null; url: string; username: string; password: string; note: string } | null>(null);
  const [pwShowInput, setPwShowInput] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const copyText = async (text: string, what: string) => {
    try { await navigator.clipboard.writeText(text); showToast(`${what}已复制`); } catch { /* 剪贴板不可用 */ }
  };
  const copyPassword = async (p: PasswordEntry) => {
    try { await copyText(await browserApi.revealPassword(p.id), "密码"); } catch (e: any) { void dialog.alert(e?.message || "读不到密码"); }
  };
  const editPassword = async (p: PasswordEntry | null) => {
    let password = "";
    if (p) { try { password = await browserApi.revealPassword(p.id); } catch { password = ""; } }
    setPwShowInput(false);
    setPwEditing({ id: p?.id || null, url: p?.url || "", username: p?.username || "", password, note: p?.note || "" });
  };
  const savePassword = async () => {
    if (!pwEditing) return;
    const { id, ...body } = pwEditing;
    try {
      if (id) await browserApi.updatePassword(id, body); else await browserApi.createPassword(body);
      setPwEditing(null); loadPasswords();
    } catch (e: any) { void dialog.alert(e?.message || "保存失败"); }
  };
  const removePassword = async (p: PasswordEntry) => {
    if (!(await dialog.confirm(`删除「${p.host || p.url}」的账号 ${p.username || ""} 的密码?不可恢复。`, { danger: true, confirmText: "删除" }))) return;
    try { await browserApi.removePassword(p.id); if (pwEditing?.id === p.id) setPwEditing(null); loadPasswords(); } catch { /* 同上 */ }
  };
  const clearPasswords = async () => {
    if (!passwords.length) return;
    if (!(await dialog.confirm(`清空全部 ${passwords.length} 条密码?不可恢复。`, { danger: true, confirmText: "清空" }))) return;
    try { await browserApi.clearPasswords(); setPwEditing(null); loadPasswords(); } catch { /* 同上 */ }
  };
  const exportPasswords = async () => {
    if (!passwords.length) return;
    try {
      const csv = await browserApi.exportPasswordsCsv();
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob); a.download = `passwords-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    } catch (e: any) { void dialog.alert(e?.message || "导出失败"); }
  };
  const importCsv = () => {
    const input = document.createElement("input");
    input.type = "file"; input.accept = ".csv,text/csv";
    input.onchange = async () => {
      const f = input.files?.[0]; if (!f) return;
      try {
        const rows = parseCsv(await f.text());
        if (!rows.length) return;
        const header = rows[0].map((h) => h.trim().toLowerCase());
        const col = (names: string[]) => header.findIndex((h) => names.includes(h));
        const iu = col(["url", "login_uri", "website", "web site", "网址", "login uri"]);
        const iuser = col(["username", "login_username", "user name", "login", "email", "用户名", "账号"]);
        const ipass = col(["password", "login_password", "密码"]);
        const inote = col(["note", "notes", "备注"]);
        if (ipass < 0) { void dialog.alert("没找到密码列:CSV 第一行要有 password / 密码 这样的表头"); return; }
        const items = rows.slice(1).map((r) => ({ url: iu >= 0 ? r[iu] : "", username: iuser >= 0 ? r[iuser] : "", password: r[ipass] || "", note: inote >= 0 ? r[inote] : "" }));
        const added = await browserApi.importPasswords(items);
        loadPasswords();
        void dialog.alert(added ? `导入 ${added} 条` : "没有新条目(都已存在)");
      } catch (e: any) { void dialog.alert(e?.message || "导入失败"); }
    };
    input.click();
  };
  const passwordMenu = (e: React.MouseEvent, p: PasswordEntry) => {
    e.preventDefault(); e.stopPropagation();
    setMenu({
      x: e.clientX, y: e.clientY,
      items: [
        { label: "复制密码", icon: <Key size={13} />, onClick: () => void copyPassword(p) },
        { label: "复制账号", icon: <User size={13} />, disabled: !p.username, onClick: () => void copyText(p.username, "账号") },
        { label: "打开网站", icon: <Globe size={13} />, disabled: !p.url, onClick: () => onOpenUrl(p.url, p.host) },
        { label: "编辑", icon: <Pencil size={13} />, onClick: () => void editPassword(p) },
        "divider" as const,
        { label: "删除", icon: <Trash size={13} />, danger: true, onClick: () => void removePassword(p) },
      ],
    });
  };

  // ── 工具行:每个子视图自己的 ＋ 与 ⋯ ──
  const placeholder = { sites: "搜索收藏…", history: "搜索历史…", passwords: "搜索密码(域名 / 账号)…" }[view];
  const addAction = view === "sites"
    ? { title: "添加网站", onClick: () => add() }
    : view === "passwords"
      ? { title: "添加密码", onClick: () => void editPassword(null) }
      : undefined;
  const moreItems = (): MenuItem[] => view === "sites"
    ? [
      { label: "新建文件夹…", icon: <FolderPlus size={13} />, onClick: () => void addFolder() },
      { label: "从 Chrome 导入书签…", icon: <Download size={13} />, onClick: () => setImportOpen(true) },
      "divider",
      { label: "展开全部", icon: <ChevronsUpDown size={13} />, disabled: !folderIds.length, onClick: expandAll },
      { label: "折叠全部", icon: <ChevronsDownUp size={13} />, disabled: !open.size, onClick: collapseAll },
    ]
    : view === "history"
      ? [{ label: "清空浏览记录", icon: <Trash size={13} />, danger: true, disabled: !history.length, onClick: () => void clearHistory() }]
      : [
        { label: "从 Chrome 导入…", icon: <Download size={13} />, onClick: () => setImportOpen(true) },
        { label: "导入 CSV…", icon: <Upload size={13} />, onClick: importCsv },
        { label: "导出 CSV", icon: <Download size={13} />, disabled: !passwords.length, onClick: () => void exportPasswords() },
        "divider",
        { label: "清空全部密码", icon: <Trash size={13} />, danger: true, disabled: !passwords.length, onClick: () => void clearPasswords() },
      ];

  // ── 拖拽(仅收藏树)──
  const dropAt = (y: number): Drop => {
    const rows = [...(listRef.current?.querySelectorAll<HTMLElement>("[data-site-id]") || [])];
    for (const el of rows) {
      const r = el.getBoundingClientRect();
      if (y < r.top || y > r.bottom) continue;
      const id = String(el.dataset.siteId);
      const row = byId.get(id);
      if (!row) continue;
      const offset = (y - r.top) / r.height;
      if (row.kind === "folder" && offset > 0.25 && offset < 0.75) return { overId: id, where: "inside" };
      return { overId: id, where: offset < 0.5 ? "before" : "after" };
    }
    const last = rows[rows.length - 1];
    return last ? { overId: String(last.dataset.siteId), where: "after" } : null;
  };
  const commit = (movedId: string, target: Drop) => {
    if (!target) return;
    const moved = byId.get(movedId);
    const over = byId.get(target.overId);
    if (!moved || !over || moved.id === over.id) return;
    const parentId: string | null = target.where === "inside" ? over.id : (over.parent_id || null);
    if (moved.kind === "folder" && isWithin(parentId, moved.id)) return;
    const siblings = childrenOf(parentId).filter((s) => s.id !== movedId);
    let index = siblings.length;
    if (target.where !== "inside") {
      const at = siblings.findIndex((s) => s.id === over.id);
      if (at >= 0) index = target.where === "before" ? at : at + 1;
    }
    const ids = siblings.map((s) => s.id);
    ids.splice(index, 0, movedId);
    setSites((prev) => prev.map((s) => (s.id === movedId ? { ...s, parent_id: parentId } : s)));
    if (parentId) setOpen((prev) => writeOpen(new Set(prev).add(parentId)));
    void browserApi.reorderBookmarks({ parentId, ids }).then(setSites).catch(load);
  };
  const startDrag = (e: React.PointerEvent, site: Bookmark) => {
    if (e.button !== 0 || needle) return;
    dragRef.current = { id: site.id, startY: e.clientY, dragging: false, drop: null };
    const onMove = (ev: PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      if (ev.buttons === 0) { onUp(); return; }
      if (!d.dragging && Math.abs(ev.clientY - d.startY) > 5) {
        d.dragging = true; setDragId(d.id); document.body.style.cursor = "grabbing"; beginGlobalDrag();
      }
      if (!d.dragging) return;
      ev.preventDefault();
      d.drop = dropAt(ev.clientY);
      setDrop(d.drop);
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      const d = dragRef.current;
      dragRef.current = null; setDragId(null); setDrop(null);
      if (!d?.dragging) return;
      document.body.style.cursor = ""; endGlobalDrag();
      suppressClick.current = true;
      window.setTimeout(() => { suppressClick.current = false; }, 0);
      commit(d.id, d.drop);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  const Row = ({ site, depth }: { site: Bookmark; depth: number }) => {
    const isFolder = site.kind === "folder";
    const expanded = isFolder && open.has(site.id);
    const marker = drop?.overId === site.id ? drop.where : null;
    return (
      <div
        data-site-id={site.id}
        onPointerDown={(e) => startDrag(e, site)}
        onClick={() => {
          if (suppressClick.current) return;
          if (isFolder) toggleFolder(site.id); else onOpenUrl(site.url, site.title);
        }}
        onContextMenu={(e) => contextMenu(e, site)}
        title={isFolder ? site.title : site.url}
        style={{ paddingLeft: 12 + depth * 16 }}
        className={[
          "group relative flex items-center gap-2 py-[5px] pr-2 cursor-pointer select-none text-text transition-colors",
          dragId === site.id ? "opacity-40" : "",
          marker === "inside" ? "bg-accent-soft" : siteEditing?.id === site.id ? "bg-bg-hover" : "hover:bg-bg-hover",
        ].join(" ")}
      >
        {marker === "before" && <span className="absolute left-3 right-2 -top-px h-0.5 rounded bg-accent" />}
        {marker === "after" && <span className="absolute left-3 right-2 -bottom-px h-0.5 rounded bg-accent" />}
        {isFolder ? (
          <>
            {expanded ? <ChevronDown size={13} className="shrink-0 text-text-faint" /> : <ChevronRight size={13} className="shrink-0 text-text-faint" />}
            <Folder size={15} className="shrink-0 text-accent" />
          </>
        ) : <Favicon url={site.url} />}
        <span className="flex-1 min-w-0 truncate text-[14px]">{site.title || hostOf(site.url)}</span>
        <button
          onClick={(e) => { e.stopPropagation(); editSite(site); }}
          onPointerDown={(e) => e.stopPropagation()}
          title={isFolder ? "重命名" : "编辑"}
          className={actionBtn}
        >
          <Pencil size={12} />
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); void remove(site); }}
          onPointerDown={(e) => e.stopPropagation()}
          title={isFolder ? "删除文件夹" : "移除"}
          className={`${actionBtn} hover:!text-danger`}
        >
          <X size={12} />
        </button>
      </div>
    );
  };
  const siteEditor = () => siteEditing && (
    <div
      className="border-b border-border bg-bg px-3 py-2 flex flex-col gap-1.5"
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => { if (e.key === "Escape") setSiteEditing(null); if (e.key === "Enter") void saveSite(); }}
    >
      {siteEditing.kind === "site" && (
        <input className={siteInputClass} placeholder="网址:example.com 或 https://…" autoFocus={siteEditing.id === null} value={siteEditing.url} onChange={(e) => setSiteEditing({ ...siteEditing, url: e.target.value })} />
      )}
      <input className={siteInputClass} placeholder={siteEditing.id === null ? "名称(留空用网站标题)" : "名称"} autoFocus={siteEditing.id !== null} value={siteEditing.title} onChange={(e) => setSiteEditing({ ...siteEditing, title: e.target.value })} />
      <div className="flex gap-1.5 pt-0.5">
        <button onClick={() => void saveSite()} className="h-7 px-3 bg-accent text-white text-[12.5px] hover:opacity-90">{siteEditing.id === null ? "添加" : "保存"}</button>
        <button onClick={() => setSiteEditing(null)} className="h-7 px-3 border border-border text-[12.5px] text-text-dim hover:text-text hover:bg-bg-hover">取消</button>
        {siteEditing.id !== null && (
          <button
            onClick={() => { const t = sites.find((x) => x.id === siteEditing.id); if (t) { setSiteEditing(null); void remove(t); } }}
            className="ml-auto h-7 px-2 text-[12.5px] text-danger hover:bg-bg-hover"
          >
            {siteEditing.kind === "folder" ? "删除" : "移除"}
          </button>
        )}
      </div>
    </div>
  );
  // 直接渲染树结构,避免父组件重渲染时重挂整棵树和正在输入的表单。
  const renderTree = (parentId: string | null, depth: number): React.ReactNode => (
    <>
      {childrenOf(parentId).map((site) => (
        <div key={site.id}>
          <Row site={site} depth={depth} />
          {siteEditing?.id === site.id && siteEditor()}
          {siteEditing?.id === null && siteEditing.parentId === site.id && siteEditor()}
          {site.kind === "folder" && open.has(site.id) && renderTree(site.id, depth + 1)}
        </div>
      ))}
    </>
  );

  const HistoryRow = ({ h }: { h: HistoryEntry }) => {
    return (
      <div
        onClick={() => onOpenUrl(h.url, h.title)}
        onContextMenu={(e) => historyMenu(e, h)}
        title={h.url}
        className="group flex items-center gap-2 py-[5px] px-3 cursor-pointer select-none hover:bg-bg-hover"
      >
        <Favicon url={h.url} />
        <span className="flex-1 min-w-0 truncate text-[13.5px] text-text">{h.title || hostOf(h.url)}</span>
        <span className="shrink-0 text-[11px] text-text-faint">{ago(h.visited_at)}</span>
      </div>
    );
  };

  const inputClass = "w-full h-7 px-2 border border-border bg-bg text-[12.5px] text-text placeholder:text-text-faint outline-none focus:border-accent";
  // 编辑表单是函数不是组件:组件每次渲染都是新身份会被重挂,输入一个字就失焦
  const passwordEditor = () => pwEditing && (
    <div className="border-b border-border bg-bg px-3 py-2 flex flex-col gap-1.5" onClick={(e) => e.stopPropagation()}>
      <input className={inputClass} placeholder="网址" autoFocus={!pwEditing.id} value={pwEditing.url} onChange={(e) => setPwEditing({ ...pwEditing, url: e.target.value })} />
      <input className={inputClass} placeholder="账号" value={pwEditing.username} onChange={(e) => setPwEditing({ ...pwEditing, username: e.target.value })} />
      <div className="flex gap-1">
        <input className={`${inputClass} font-mono`} type={pwShowInput ? "text" : "password"} placeholder="密码" value={pwEditing.password} onChange={(e) => setPwEditing({ ...pwEditing, password: e.target.value })} />
        <button onClick={() => setPwShowInput((v) => !v)} title="显示 / 隐藏" className="shrink-0 w-7 h-7 flex items-center justify-center text-text-faint hover:text-text hover:bg-bg-hover">
          {pwShowInput ? <EyeOff size={13} /> : <Eye size={13} />}
        </button>
      </div>
      <input className={inputClass} placeholder="备注" value={pwEditing.note} onChange={(e) => setPwEditing({ ...pwEditing, note: e.target.value })} />
      <div className="flex gap-1.5 pt-0.5">
        <button onClick={() => void savePassword()} className="h-7 px-3 bg-accent text-white text-[12.5px] hover:opacity-90">保存</button>
        <button onClick={() => setPwEditing(null)} className="h-7 px-3 border border-border text-[12.5px] text-text-dim hover:text-text hover:bg-bg-hover">取消</button>
        {pwEditing.id && (
          <button
            onClick={() => { const p = passwords.find((x) => x.id === pwEditing.id); if (p) void removePassword(p); }}
            className="ml-auto h-7 px-2 text-[12.5px] text-danger hover:bg-bg-hover"
          >
            删除
          </button>
        )}
      </div>
    </div>
  );

  const PasswordRow = ({ p }: { p: PasswordEntry }) => {
    return (
      <>
        <div
          onContextMenu={(e) => passwordMenu(e, p)}
          onClick={() => { if (p.url) onOpenUrl(p.url, p.host); else void editPassword(p); }}
          title={p.url || p.host}
          className="group flex items-center gap-2 py-[5px] px-3 cursor-pointer select-none hover:bg-bg-hover"
        >
          {p.url ? <Favicon url={p.url} /> : <Key size={14} className="shrink-0 text-text-faint" />}
          <div className="flex-1 min-w-0">
            <div className="truncate text-[13.5px] text-text">{p.host || p.url || "(无网址)"}</div>
            <div className="truncate text-[11.5px] text-text-faint font-mono">
              {p.username || <i>无账号</i>}
            </div>
          </div>
          <button
            onClick={(e) => { e.stopPropagation(); void copyText(p.username, "账号"); }}
            title="复制账号"
            disabled={!p.username}
            className={`${actionBtn} disabled:opacity-40`}
          >
            <User size={12} />
          </button>
          <button onClick={(e) => { e.stopPropagation(); void copyPassword(p); }} title="复制密码" className={actionBtn}>
            <Key size={12} />
          </button>
        </div>
        {pwEditing?.id === p.id && passwordEditor()}
      </>
    );
  };

  const siteHits = needle
    ? sites.filter((s) => s.kind === "site" && (s.title.toLowerCase().includes(needle) || hostOf(s.url).toLowerCase().includes(needle))).slice(0, 50)
    : [];
  const passwordRows = needle
    ? passwords.filter((p) => p.host.includes(needle) || p.url.toLowerCase().includes(needle) || p.username.toLowerCase().includes(needle)).slice(0, 50)
    : passwords;
  const groups = useMemo(() => {
    const out: { label: string; rows: HistoryEntry[] }[] = [];
    for (const h of history) {
      const label = dayLabel(h.visited_at);
      const last = out[out.length - 1];
      if (last && last.label === label) last.rows.push(h); else out.push({ label, rows: [h] });
    }
    return out;
  }, [history]);

  const empty = (text: string) => <div className="px-3 py-6 text-center text-[12.5px] text-text-faint">{text}</div>;

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      {/* 子视图切换 */}
      <div className="shrink-0 flex px-2 pt-1.5 pb-1">
        {([["sites", "收藏", Star], ["history", "历史", History], ["passwords", "密码", Key]] as const).map(([id, label, Icon]) => (
          <button
            key={id}
            onClick={() => switchView(id)}
            className={["flex-1 h-6 rounded flex items-center justify-center gap-1 text-[12px] transition-colors", view === id ? "bg-bg-inset text-text font-medium" : "text-text-faint hover:text-text"].join(" ")}
          >
            <Icon size={12} /> {label}
          </button>
        ))}
      </div>
      <Toolbar value={q} onChange={setQ} placeholder={placeholder} add={addAction} more={moreItems} />

      {view === "sites" ? (
        <div ref={listRef} className="flex-1 overflow-y-auto">
          {needle ? (
            <>
              {siteHits.map((site) => (
                <div key={site.id} onClick={() => onOpenUrl(site.url, site.title)} onContextMenu={(e) => contextMenu(e, site)} title={site.url}
                  className="flex items-center gap-2 py-[5px] px-3 cursor-pointer select-none hover:bg-bg-hover">
                  <Favicon url={site.url} />
                  <span className="shrink-0 truncate max-w-[60%] text-[13.5px] text-text">{site.title || hostOf(site.url)}</span>
                  <span className="flex-1 min-w-0 truncate text-[11px] text-text-faint">{pathOf(site) || hostOf(site.url)}</span>
                </div>
              ))}
              {!siteHits.length && empty("没有匹配的收藏")}
            </>
          ) : (
            <>
              {siteEditing?.id === null && !siteEditing.parentId && siteEditor()}
              {renderTree(null, 0)}
              {sitesLoaded && !sites.length && !siteEditing && (
                <PanelEmptyState
                  title="还没有收藏的网站"
                  description="从 Chrome 导入书签，也可以点击上方 ＋ 添加常用网站。"
                  action="从 Chrome 导入"
                  icon={<Download size={13} />}
                  onAction={() => setImportOpen(true)}
                />
              )}
            </>
          )}
        </div>
      ) : view === "history" ? (
        <div className="flex-1 overflow-y-auto">
          {needle ? (
            <>
              {hits.map((h) => <HistoryRow key={h.url} h={h} />)}
              {!hits.length && empty("没有匹配的记录")}
            </>
          ) : (
            <>
              {groups.map((g) => (
                <div key={g.label}>
                  <div className="px-3 pt-2 pb-0.5 text-[11px] font-medium text-text-faint select-none">{g.label}</div>
                  {g.rows.map((h) => <HistoryRow key={h.url} h={h} />)}
                </div>
              ))}
              {!history.length && empty("还没有浏览记录")}
            </>
          )}
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto">
          {pwEditing && !pwEditing.id && passwordEditor()}
          {passwordRows.map((p) => <div key={p.id}>{PasswordRow({ p })}</div>)}
          {!passwordRows.length && !pwEditing && (
            needle
              ? empty("没有匹配的密码")
              : (
                <div className="px-4 py-8 text-center text-[12.5px] text-text-faint leading-relaxed">
                  还没有密码。<br />从 Chrome 导入,或导入密码管理器导出的 CSV。
                  <div className="mt-3">
                    <button onClick={() => setImportOpen(true)} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-accent text-white text-[12.5px] hover:opacity-90">
                      <Download size={13} /> 从 Chrome 导入
                    </button>
                  </div>
                </div>
              )
          )}
        </div>
      )}
      {menu && <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />}
      {importOpen && (
        <ChromeImportDialog
          onClose={() => setImportOpen(false)}
          onDone={(r) => {
            loadPasswords(); load();
            showToast(`已从 ${r.profile} 导入:${r.imported} 条登录信息${r.bookmarks ? `、${r.bookmarks} 个网站` : ""}${r.passwords ? `、${r.passwords} 条密码` : ""}`);
          }}
        />
      )}
    </div>
  );
}

/** 解析 CSV:引号、引号内逗号与换行、双引号转义都认。 */
function parseCsv(text: string): string[][] {
  const rows: string[][] = []; let row: string[] = [], cell = "", inQ = false;
  const s = text.replace(/^﻿/, "");
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQ) {
      if (c === '"') { if (s[i + 1] === '"') { cell += '"'; i++; } else inQ = false; }
      else cell += c;
    } else if (c === '"') inQ = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") { if (c === "\r" && s[i + 1] === "\n") i++; row.push(cell); rows.push(row); row = []; cell = ""; }
    else cell += c;
  }
  if (cell.length || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((x) => x.trim() !== ""));
}

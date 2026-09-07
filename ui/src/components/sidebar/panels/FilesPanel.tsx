import { fileIconFor, fileColorFor } from "../../files/icons";
import { type GitRepositoryStatus, gitApi } from "../../../api/git";
import { type FileNode, filesApi } from "../../../api/files";
import { systemApi } from "../../../api/system";
import { useCallback, useEffect, useRef, useState } from "react";
import { NodeRow, InlineCreateRow, type TreeControls } from "./NodeRow";
import { ContextMenu, dialog, type MenuItem } from "../../ui";
import { Folder, FolderPlus, FolderOpen, FileText, Trash, Pencil, Copy, PanelRight, Terminal, GitBranch, Scissors, ClipboardPaste } from "../../ui/icons";

const REVEAL_LABEL = /Mac/i.test(navigator.platform) ? "在 Finder 中显示"
  : /Win/i.test(navigator.platform) ? "在资源管理器中显示" : "在文件管理器中显示";
import { DndContext, DragOverlay, useDroppable } from "@dnd-kit/core";
import { useTreeDnd, ROOT_ID } from "./useTreeDnd";
import { AddRootDialog } from "./AddRootDialog";
import { PanelEmptyState } from "./PanelEmptyState";
import { PanelCreateAction } from "./PanelCreateAction";

// 文件面板:真实文件系统的树。多选/键盘/剪贴板/拖拽/Git 染色/筛选都内聚在此;
// 宿主(PanelHost)只负责装卸与显隐 —— 本面板常驻挂载,展开集/多选等重状态跨切换保活。
export function FilesPanel({
  active,
  selectedId,
  onSelect,
  onOpenSide,
  onOpenTerminal,
  onOpenGit,
  refreshKey,
  onChanged,
}: {
  /** 当前是否为激活面板:控制显隐与键盘/Git 轮询的闸门(组件本身常驻)。 */
  active: boolean;
  selectedId: string;
  onSelect: (n: FileNode | null) => void;
  onOpenSide?: (n: FileNode) => void;
  onOpenTerminal?: (n: FileNode, opts?: { command?: string; titlePrefix?: string }) => void;
  onOpenGit?: (repo: GitRepositoryStatus) => void;
  refreshKey: number;
  onChanged?: () => void;
}) {
  const [roots, setRoots] = useState<FileNode[]>([]);
  const [addRootOpen, setAddRootOpen] = useState(false);
  const [rootPathDraft, setRootPathDraft] = useState("");
  const [rootError, setRootError] = useState<string | null>(null);
  const [addingRoot, setAddingRoot] = useState(false);
  const [pickingDirectory, setPickingDirectory] = useState(false);
  const autoExpandedRoots = useRef<Set<string>>(new Set());

  // 展开集
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const toggleExpand = (id: string) =>
    setExpandedIds((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const setExpanded = (id: string, on: boolean) =>
    setExpandedIds((s) => { const n = new Set(s); on ? n.add(id) : n.delete(id); return n; });

  // ── 多选(VS Code 资源管理器同款):Cmd/Ctrl 点选切换,Shift 范围选 ──
  const [multiSel, setMultiSel] = useState<Set<string>>(new Set());
  const multiSelRef = useRef(multiSel);
  multiSelRef.current = multiSel;
  const anchorRef = useRef<string | null>(null);
  const clearMulti = useCallback(() => { if (multiSelRef.current.size) setMultiSel(new Set()); }, []);
  /** 树的可见顺序 = DOM 顺序(data-nid 只有文件树的行在用)。 */
  const visibleTreeIds = () =>
    Array.from(document.querySelectorAll("[data-nid]")).map((el) => String(el.getAttribute("data-nid") || ""));
  /** 剔除「祖先也被选中」的行:id 就是绝对路径,前缀判断即可。 */
  const pruneNested = (ids: string[]) =>
    ids.filter((id) => !ids.some((other) => other !== id && id.startsWith(other + "/")));

  const handleRowClick = (e: React.MouseEvent, node: FileNode) => {
    if (e.metaKey || e.ctrlKey) {
      // 点选切换;从单选进入多选时把当前选中项一并带上
      setMultiSel((prev) => {
        const next = new Set(prev.size ? prev : selectedId ? [selectedId] : []);
        next.has(node.id) ? next.delete(node.id) : next.add(node.id);
        return next;
      });
      anchorRef.current = node.id;
      return;
    }
    if (e.shiftKey) {
      const order = visibleTreeIds();
      const from = anchorRef.current && order.includes(anchorRef.current)
        ? anchorRef.current
        : order.includes(selectedId) ? selectedId : node.id;
      const a = order.indexOf(from);
      const b = order.indexOf(node.id);
      if (a !== -1 && b !== -1) {
        setMultiSel(new Set(order.slice(Math.min(a, b), Math.max(a, b) + 1)));
        return;
      }
    }
    // 普通点击:回到单选,文件夹顺带展开/收起
    anchorRef.current = node.id;
    clearMulti();
    handleSelect(node);
    if (node.kind === "folder") toggleExpand(node.id);
  };

  useEffect(() => { clearMulti(); }, [active, clearMulti]);

  // 创建
  const [creatingUnder, setCreatingUnder] = useState<string | null>(null);
  const [creatingKind, setCreatingKind] = useState<"folder" | "file">("folder");
  const [draftTitle, setDraftTitle] = useState("");

  // 重命名
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");

  // 菜单
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[]; nodeId?: string } | null>(null);

  const load = useCallback(async () => {
    const result = await filesApi.listRoots();
    setRoots(result.items || []);
  }, []);

  // 变更后:既刷新根,又冒泡到 App 让 refreshKey 自增 → 所有展开的子节点立即重载
  const refresh = useCallback(() => { load(); onChanged?.(); }, [load, onChanged]);

  // 拖拽:状态 + 落库都在 hook 里(多选时拖任一选中项 = 整组搬)
  const { sensors, activeNode, overDirId, dndHandlers } = useTreeDnd({
    refresh,
    setExpanded,
    getSelection: () => [...multiSelRef.current],
  });

  // ── 键盘与剪贴板(资源管理器快捷键)──
  // 行注册表:渲染时把 FileNode 对象按 id 登记,键盘操作按 anchor 查对象
  const nodesRef = useRef(new Map<string, FileNode>());
  const registerNode = useCallback((n: FileNode) => { nodesRef.current.set(n.id, n); }, []);
  /** 内部文件剪贴板:复制(可反复粘贴)/ 剪切(粘贴即移动,行半透明标记)。 */
  const clipboardRef = useRef<{ ids: string[]; cut: boolean } | null>(null);
  const [cutIds, setCutIds] = useState<Set<string>>(new Set());
  const rootsRef = useRef(roots); rootsRef.current = roots;
  const selectedIdRef = useRef(selectedId); selectedIdRef.current = selectedId;
  const expandedRef = useRef(expandedIds); expandedRef.current = expandedIds;
  const activeRef = useRef(active); activeRef.current = active;

  /** 删除一组 id(菜单与 Delete 键共用):祖先已选剔除后代;工作区走移除。 */
  const deleteIds = useCallback(async (rawIds: string[]) => {
    const ids = pruneNested(rawIds.filter(Boolean));
    if (!ids.length) return;
    const selectedRoots = ids.filter((id) => rootsRef.current.some((r) => r.id === id && r.isRoot));
    const normal = ids.filter((id) => !selectedRoots.includes(id));
    const hint = selectedRoots.length ? `\n其中 ${selectedRoots.length} 个是已添加的文件夹:只从列表移除,不删磁盘文件。` : "";
    const label = rawIds.length === 1
      ? `「${nodesRef.current.get(rawIds[0])?.title || rawIds[0].split("/").pop()}」`
      : `选中的 ${rawIds.length} 项`;
    if (!(await dialog.confirm(`删除${label}?文件夹内的内容会一起删除。${hint}`, { danger: true, confirmText: "删除" }))) return;
    for (const id of selectedRoots) await filesApi.removeRoot(id).catch(() => {});
    for (const id of normal) await filesApi.deleteNode(id).catch(() => {});
    if (rawIds.includes(selectedIdRef.current)) onSelect(null);
    clearMulti();
    refresh();
  }, [clearMulti, onSelect, refresh]);

  /** 复制/剪切当前选择进内部剪贴板(工作区根除外)。 */
  const copySelection = useCallback((cut: boolean) => {
    const ids = multiSelRef.current.size ? [...multiSelRef.current] : anchorRef.current ? [anchorRef.current] : [];
    const usable = ids.filter((id) => !rootsRef.current.some((r) => r.id === id && r.isRoot));
    if (!usable.length) return;
    clipboardRef.current = { ids: usable, cut };
    setCutIds(cut ? new Set(usable) : new Set());
  }, []);

  /** 粘贴到 anchor 所在目录(anchor 是文件夹 → 进它;是文件 → 进它的父级)。 */
  const pasteClipboard = useCallback(async () => {
    const clip = clipboardRef.current;
    if (!clip?.ids.length) return;
    const anchorNode = anchorRef.current ? nodesRef.current.get(anchorRef.current) : null;
    const targetDir = anchorNode
      ? anchorNode.kind === "folder" ? anchorNode.id : (anchorNode.parent_id || rootsRef.current[0]?.id)
      : rootsRef.current[0]?.id;
    if (!targetDir) return;
    const ids = pruneNested(clip.ids).filter((id) => !(targetDir === id || targetDir.startsWith(id + "/")));
    for (const id of ids) {
      if (clip.cut) {
        try { await filesApi.moveNode(id, targetDir); }
        catch (e: any) {
          if (/已有同名/.test(e?.message || "") && (await dialog.confirm(`${e.message}。是否覆盖?被覆盖的文件将移入废纸篓。`, { danger: true, confirmText: "覆盖" }))) {
            await filesApi.moveNode(id, targetDir, true).catch((err: any) => void dialog.alert(err?.message || "移动失败"));
          } else if (!/已有同名/.test(e?.message || "")) void dialog.alert(e?.message || "移动失败");
        }
      } else {
        await filesApi.copyNode(id, targetDir).catch((e: any) => void dialog.alert(e.message || "复制失败"));
      }
    }
    if (clip.cut) { clipboardRef.current = null; setCutIds(new Set()); }
    setExpanded(targetDir, true);
    refresh();
  }, [refresh, setExpanded]);

  // ── 外部拖入导入(从 Finder 拖文件/文件夹进树)──
  // webkitGetAsEntry 递归展开目录;内容经 FileReader 读出走 /api/files/tree/import 落盘。
  const traverseEntry = async (entry: any, prefix: string, out: { file: File; rel: string }[]) => {
    if (!entry || out.length >= 200) return;
    if (entry.isFile) {
      await new Promise<void>((done) => entry.file((f: File) => { out.push({ file: f, rel: prefix + f.name }); done(); }, () => done()));
      return;
    }
    if (entry.isDirectory) {
      const reader = entry.createReader();
      // readEntries 按批返回(每批至多 100),读空为止
      for (;;) {
        const batch: any[] = await new Promise((done) => reader.readEntries((es: any[]) => done(es), () => done([])));
        if (!batch.length) break;
        for (const child of batch) await traverseEntry(child, `${prefix}${entry.name}/`, out);
        if (out.length >= 200) break;
      }
    }
  };

  const onExternalDragOver = (e: React.DragEvent) => {
    if (e.dataTransfer?.types?.includes("Files")) e.preventDefault(); // 允许 drop
  };
  const onExternalDrop = async (e: React.DragEvent) => {
    if (!e.dataTransfer?.types?.includes("Files")) return;
    e.preventDefault();
    e.stopPropagation();
    // 落点:悬停行是文件夹 → 进它;是文件 → 进它的父级;空白处 → 第一个工作区
    const rowEl = (e.target as HTMLElement).closest?.("[data-nid]");
    const node = rowEl ? nodesRef.current.get(String(rowEl.getAttribute("data-nid"))) : null;
    const parentId = node ? (node.kind === "folder" ? node.id : node.parent_id || undefined) : rootsRef.current[0]?.id;
    const out: { file: File; rel: string }[] = [];
    for (const item of [...(e.dataTransfer.items || [])]) {
      const entry = (item as any).webkitGetAsEntry?.();
      if (entry) await traverseEntry(entry, "", out);
      else { const f = item.getAsFile?.(); if (f) out.push({ file: f, rel: f.name }); }
    }
    if (!out.length) return;
    let done = 0, failed = 0, bytes = 0;
    for (const { file, rel } of out.slice(0, 200)) {
      if (file.size > 20 * 1024 * 1024 || (bytes += file.size) > 100 * 1024 * 1024) { failed += 1; continue; }
      try {
        const dataBase64 = await new Promise<string>((resolve, reject) => {
          const r = new FileReader();
          r.onerror = () => reject(r.error);
          r.onload = () => resolve(String(r.result).split(",")[1] || "");
          r.readAsDataURL(file);
        });
        await filesApi.importFile({ parentId, relPath: rel, dataBase64 });
        done += 1;
      } catch { failed += 1; }
    }
    if (parentId) setExpanded(parentId, true);
    refresh();
    if (failed) void dialog.alert(`导入完成:${done} 个成功,${failed} 个失败或超限(单文件 ≤20MB,单次 ≤200 个 / 100MB)`);
  };

  // ── Git 状态标记:文件按状态染色,脏目录点标 ──
  const [gitMarks, setGitMarks] = useState<{ files: Map<string, string>; dirs: Set<string> }>({ files: new Map(), dirs: new Set() });
  useEffect(() => {
    if (!active) return;
    let stale = false;
    gitApi.gitStatus().then((r) => {
      if (stale) return;
      const files = new Map<string, string>();
      const dirs = new Set<string>();
      // git 会 C-quote 带空格/非 ASCII 的路径("sub/d copy.txt"),先反引号
      const unquote = (p: string) => (p.startsWith('"') && p.endsWith('"') ? p.slice(1, -1).replace(/\\(.)/g, "$1") : p);
      const mark = (abs: string, status: string) => {
        // git 解析 symlink 后是 /private/tmp,树节点可能是 /tmp —— 两种键都登记
        for (const key of new Set([abs, abs.replace(/^\/private\/(tmp|var)\//, "/$1/")])) {
          files.set(key, status);
          let dir = key;
          while (dir.includes("/") && dir.length > 2) {
            dir = dir.slice(0, dir.lastIndexOf("/"));
            if (!dir) break;
            dirs.add(dir);
          }
        }
      };
      for (const repository of r.repositories || []) {
        const base = repository.root || repository.fileRootPath;
        for (const f of repository.files || []) mark(`${base}/${unquote(f.path)}`, f.status);
      }
      setGitMarks({ files, dirs });
    }).catch(() => {});
    return () => { stale = true; };
  }, [refreshKey, active]);

  /** 结果行的路径列:相对所属工作区,而不是甩一整条绝对路径。 */

  // 每渲染刷新一次的「最新函数」出口,键盘 handler 通过它调用,不吃过期闭包
  const keyApiRef = useRef({ handleSelect: (_n: FileNode | null) => {}, startRename: (_n: FileNode) => {}, toggleExpand: (_id: string) => {}, setExpanded: (_id: string, _on: boolean) => {} });

  useEffect(() => {
    const isTyping = (target: EventTarget | null) => {
      const el = target as HTMLElement | null;
      if (!el) return false;
      const tag = (el.tagName || "").toLowerCase();
      return tag === "input" || tag === "textarea" || !!el.isContentEditable;
    };
    const focusRow = (id: string) => {
      anchorRef.current = id;
      setMultiSel(new Set([id]));
      document.querySelector(`[data-nid="${CSS.escape(id)}"]`)?.scrollIntoView({ block: "nearest" });
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { clearMulti(); return; }
      if (!activeRef.current || isTyping(e.target)) return;
      const anchor = anchorRef.current;
      const engaged = !!anchor || multiSelRef.current.size > 0;
      if (!engaged) return; // 没点过树,不抢任何键
      const meta = e.metaKey || e.ctrlKey;
      const key = e.key;

      // 删除:Delete 或 Cmd/Ctrl+Backspace(VS Code mac 同款)
      if (key === "Delete" || (key === "Backspace" && meta)) {
        e.preventDefault();
        void deleteIds(multiSelRef.current.size ? [...multiSelRef.current] : anchor ? [anchor] : []);
        return;
      }
      if (meta && key.toLowerCase() === "a") {
        e.preventDefault();
        setMultiSel(new Set(visibleTreeIds()));
        return;
      }
      // 复制/剪切/粘贴:页面上有文字选区时让位给系统复制
      if (meta && key.toLowerCase() === "c" && !String(window.getSelection() || "")) { copySelection(false); return; }
      if (meta && key.toLowerCase() === "x" && !String(window.getSelection() || "")) { copySelection(true); return; }
      if (meta && key.toLowerCase() === "v" && clipboardRef.current) { void pasteClipboard(); return; }

      // Enter / F2:进入重命名(VS Code mac 习惯;文件、文件夹、工作区根都适用)
      if ((key === "F2" || key === "Enter") && anchor && !meta) {
        const node = nodesRef.current.get(anchor);
        if (!node) return;
        e.preventDefault();
        keyApiRef.current.startRename(node);
        return;
      }
      // ⌘↓:打开(文件开标签,文件夹展开/收起)—— 打开的键位让给它,Enter 归重命名
      if (meta && key === "ArrowDown" && anchor) {
        const node = nodesRef.current.get(anchor);
        if (!node) return;
        e.preventDefault();
        if (node.kind === "folder") keyApiRef.current.toggleExpand(node.id);
        else keyApiRef.current.handleSelect(node);
        return;
      }

      if (["ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight"].includes(key)) {
        if (meta) return; // 带 ⌘ 的方向键不参与焦点移动
        e.preventDefault();
        const order = visibleTreeIds();
        if (!order.length) return;
        const cur = anchor ? order.indexOf(anchor) : -1;
        if (key === "ArrowDown" || key === "ArrowUp") {
          const nextIdx = cur === -1
            ? (key === "ArrowDown" ? 0 : order.length - 1)
            : Math.max(0, Math.min(order.length - 1, cur + (key === "ArrowDown" ? 1 : -1)));
          const id = order[nextIdx];
          if (e.shiftKey) {
            setMultiSel((prev) => { const n = new Set(prev.size ? prev : anchor ? [anchor] : []); n.add(id); return n; });
            anchorRef.current = id;
            document.querySelector(`[data-nid="${CSS.escape(id)}"]`)?.scrollIntoView({ block: "nearest" });
          } else focusRow(id);
          return;
        }
        if (!anchor) return;
        const node = nodesRef.current.get(anchor);
        if (key === "ArrowRight") {
          if (node?.kind === "folder" && !expandedRef.current.has(anchor)) keyApiRef.current.setExpanded(anchor, true);
          else if (cur >= 0 && cur < order.length - 1) focusRow(order[cur + 1]);
          return;
        }
        // ArrowLeft:展开的文件夹先收起;否则跳到父级
        if (node?.kind === "folder" && expandedRef.current.has(anchor)) { keyApiRef.current.setExpanded(anchor, false); return; }
        const parent = anchor.slice(0, anchor.lastIndexOf("/"));
        if (order.includes(parent)) focusRow(parent);
        return;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [clearMulti, copySelection, deleteIds, pasteClipboard]);

  useEffect(() => { load(); }, [load, refreshKey]);

  useEffect(() => {
    const nextIds = roots.filter((root) => root.isRoot && !autoExpandedRoots.current.has(root.id)).map((root) => root.id);
    if (!nextIds.length) return;
    nextIds.forEach((id) => autoExpandedRoots.current.add(id));
    setExpandedIds((current) => {
      const next = new Set(current);
      nextIds.forEach((id) => next.add(id));
      return next;
    });
  }, [roots]);

  // ── 创建 ──
  const startCreate = (parentId: string | null, kind: "folder" | "file") => {
    setCreatingUnder(parentId === null ? "" : parentId);
    setCreatingKind(kind);
    setDraftTitle("");
    if (parentId) setExpanded(parentId, true);
  };
  const commitCreate = async () => {
    const title = draftTitle.trim();
    if (creatingUnder === null) return;
    if (!title) { setCreatingUnder(null); setDraftTitle(""); return; }
    const parentId = creatingUnder === "" ? undefined : creatingUnder;
    const result = await filesApi.createNode({ kind: creatingKind, title, parentId });
    setCreatingUnder(null);
    setDraftTitle("");
    handleSelect(result.item);
    refresh();
  };
  const cancelCreate = () => { setCreatingUnder(null); setDraftTitle(""); };

  const openAddRoot = () => {
    setRootPathDraft("");
    setRootError(null);
    setAddRootOpen(true);
  };
  useEffect(() => {
    const open = () => openAddRoot();
    window.addEventListener("worktop:add-root", open);
    return () => window.removeEventListener("worktop:add-root", open);
  }, []);

  const addRoot = async () => {
    const rootPath = rootPathDraft.trim();
    if (!rootPath) return;
    setAddingRoot(true);
    setRootError(null);
    try {
      const result = await filesApi.addRoot({ path: rootPath });
      setExpanded(result.item.id, true);
      handleSelect(result.item);
      setAddRootOpen(false);
      setRootPathDraft("");
      refresh();
    } catch (e: any) {
      setRootError(e.message || "添加文件夹失败");
    } finally {
      setAddingRoot(false);
    }
  };

  const pickDirectory = async () => {
    setPickingDirectory(true);
    setRootError(null);
    try {
      const result = await systemApi.pickDirectory();
      if (result.path) setRootPathDraft(result.path);
    } catch (e: any) {
      setRootError(e.message || "选择目录失败");
    } finally {
      setPickingDirectory(false);
    }
  };

  // ── 重命名 ──
  const startRename = (n: FileNode) => { setRenamingId(n.id); setRenameDraft(n.title); };
  const commitRename = async () => {
    const id = renamingId;
    const title = renameDraft.trim();
    setRenamingId(null);
    if (!id || !title) return;
    try {
      await filesApi.updateNode(id, { title });
    } catch (e: any) {
      // 重名:确认后覆盖(旧的进废纸篓),否则放弃
      if (/已有同名/.test(e?.message || "") && (await dialog.confirm(`${e.message}。是否覆盖?被覆盖的文件将移入废纸篓。`, { danger: true, confirmText: "覆盖" }))) {
        await filesApi.updateNode(id, { title, overwrite: true }).catch((err: any) => void dialog.alert(err?.message || "重命名失败"));
      } else if (!/已有同名/.test(e?.message || "")) {
        void dialog.alert(e?.message || "重命名失败");
      }
    }
    refresh();
  };
  const cancelRename = () => { setRenamingId(null); setRenameDraft(""); };

  // ── 右键 ──
  const onNodeContext = async (e: React.MouseEvent, node: FileNode) => {
    e.preventDefault();
    e.stopPropagation();

    // 多选状态下:在选中项上右键 → 批量菜单;在选区外右键 → 退回单选(VS Code 行为)
    if (multiSel.size > 1) {
      if (multiSel.has(node.id)) {
        const count = multiSel.size;
        setMenu({
          nodeId: node.id,
          x: e.clientX, y: e.clientY,
          items: [
            { label: `复制(${count} 项)`, icon: <Copy size={13} />, onClick: () => copySelection(false) },
            { label: `剪切(${count} 项)`, icon: <Scissors size={13} />, onClick: () => copySelection(true) },
            { label: `复制路径(${count} 项)`, icon: <Copy size={13} />,
              onClick: async () => {
                const text = [...multiSel].join("\n");
                try { await navigator.clipboard.writeText(text); } catch { /* 剪贴板不可用就算了 */ }
              } },
            "divider",
            { label: `删除选中的 ${count} 项`, icon: <Trash size={13} />, danger: true,
              onClick: () => { void deleteIds([...multiSel]); } },
          ],
        });
        return;
      }
      clearMulti(); // 选区外右键:清多选,走单项菜单
    }
    anchorRef.current = node.id; // 右键即聚焦:粘贴/键盘操作以它为落点

    const items: MenuItem[] = [];
    let gitRepo: GitRepositoryStatus | null = null;
    if (node.kind === "folder" && onOpenGit) {
      try {
        gitRepo = (await gitApi.gitRepository(node.id)).repository;
      } catch {
        gitRepo = null;
      }
    }
    if (node.kind === "folder") {
      items.push(
        { label: "新建文件夹", icon: <Folder size={13} className="text-accent" />,
          onClick: () => startCreate(node.id, "folder") },
        { label: "新建文件", icon: <FileText size={13} className="text-text-faint" />,
          onClick: () => startCreate(node.id, "file") },
        "divider",
      );
    }
    const copyText = node.id;
    if (node.kind !== "folder" && onOpenSide) {
      items.push(
        { label: "打开到侧边", icon: <PanelRight size={13} />, onClick: () => onOpenSide(node) },
        "divider",
      );
    }
    if (!node.isRoot) {
      items.push(
        { label: "复制", icon: <Copy size={13} />,
          onClick: () => { clipboardRef.current = { ids: [node.id], cut: false }; setCutIds(new Set()); } },
        { label: "剪切", icon: <Scissors size={13} />,
          onClick: () => { clipboardRef.current = { ids: [node.id], cut: true }; setCutIds(new Set([node.id])); } },
      );
    }
    if (clipboardRef.current?.ids.length) {
      items.push({
        label: `粘贴(${clipboardRef.current.ids.length} 项)`, icon: <ClipboardPaste size={13} />,
        onClick: () => { void pasteClipboard(); },
      });
    }
    items.push(
      { label: "重命名", icon: <Pencil size={13} />, onClick: () => startRename(node) },
      { label: "复制路径", icon: <Copy size={13} />,
        onClick: async () => {
          try { await navigator.clipboard.writeText(copyText); }
          catch {
            const ta = document.createElement("textarea");
            ta.value = copyText; document.body.appendChild(ta);
            ta.select(); document.execCommand("copy"); document.body.removeChild(ta);
          }
        },
      },
      { label: REVEAL_LABEL, icon: <FolderOpen size={13} />, onClick: () => { systemApi.revealNode(node.id).catch(() => {}); } },
      "divider",
      { label: "打开终端", icon: <Terminal size={13} className="text-success" />,
        onClick: () => onOpenTerminal?.(node), disabled: !onOpenTerminal },
      { label: "启动 Codex", icon: <Terminal size={13} className="text-success" />,
        onClick: () => onOpenTerminal?.(node, { command: "codex", titlePrefix: "Codex" }), disabled: !onOpenTerminal },
      { label: "启动 Claude Code", icon: <Terminal size={13} className="text-success" />,
        onClick: () => onOpenTerminal?.(node, { command: "claude", titlePrefix: "Claude Code" }), disabled: !onOpenTerminal },
      "divider",
    );
    if (gitRepo?.root) {
      items.push(
        {
          label: `Git 变更 (${gitRepo.files.length})`,
          icon: <GitBranch size={13} className="text-accent" />,
          onClick: () => onOpenGit?.(gitRepo!),
        },
        "divider",
      );
    }
    items.push(
      { label: node.isRoot ? "移除文件夹" : "删除", icon: <Trash size={13} />, danger: true,
        onClick: async () => {
          if (node.isRoot) {
            if (!(await dialog.confirm(`移除文件夹「${node.title}」?\n不会删除磁盘文件。`, { danger: true, confirmText: "移除" }))) return;
            await filesApi.removeRoot(node.id);
          } else {
            if (!(await dialog.confirm(`删除「${node.title}」?${node.kind === "folder" ? "\n里面所有内容也会一起删除。" : ""}`, { danger: true, confirmText: "删除" }))) return;
            await filesApi.deleteNode(node.id);
          }
          if (selectedId === node.id) onSelect(null);
          refresh();
        },
      },
    );
    setMenu({ x: e.clientX, y: e.clientY, items, nodeId: node.id });
  };

  const onBlankContext = (e: React.MouseEvent) => {
    e.preventDefault();
    setMenu({
      x: e.clientX, y: e.clientY,
      items: [
        { label: "添加文件夹", icon: <FolderPlus size={13} className="text-accent" />, onClick: openAddRoot },
      ],
    });
  };

  // 选中直接上抛(移动端「选中即收抽屉」由宿主包装)
  const handleSelect = onSelect;

  // 键盘 handler 的最新函数出口(handler 只挂一次,经 ref 调最新实现)
  keyApiRef.current = { handleSelect, startRename, toggleExpand, setExpanded };

  const controls: TreeControls = {
    contextMenuId: menu?.nodeId ?? null,
    expandedIds, toggleExpand, setExpanded,
    creatingUnder, creatingKind, draftTitle, setDraftTitle, commitCreate, cancelCreate,
    renamingId, renameDraft, setRenameDraft, commitRename, cancelRename,
    activeId: activeNode?.id || null, overDirId,
    multiSelectedIds: multiSel,
    cutIds,
    registerNode,
    gitMarks,
  };
  return (
    <DndContext sensors={sensors} {...dndHandlers}>
      {/* 身体:未激活仅隐藏 —— 展开集/多选/键盘锚点等重状态跨面板切换保活 */}
      <div className={active ? "flex flex-col flex-1 min-h-0" : "hidden"}>
        {/* 面板内部的入口:添加文件夹(样式同对话面板的「新建对话」);一个都没有时由下面的空状态承担 */}
        {roots.length > 0 && (
          <PanelCreateAction label="添加文件夹" onClick={openAddRoot} />
        )}

        <RootDroppable onContextMenu={onBlankContext} onNativeDragOver={onExternalDragOver} onNativeDrop={onExternalDrop}>
          {creatingUnder === "" && <InlineCreateRow depth={0} controls={controls} />}

          {/* 默认一个工作区都没有:说清楚,给唯一的入口 —— 添加文件夹 */}
          {!roots.length && creatingUnder !== "" && (
            <PanelEmptyState
              title="还没有添加文件夹"
              description="添加常用文件夹，在这里浏览和编辑文件。"
              action="添加文件夹"
              icon={<FolderPlus size={13} />}
              onAction={openAddRoot}
            />
          )}

          {roots.map((node) => (
            <NodeRow
              key={node.id}
              node={node}
              selectedId={selectedId}
              onRowClick={handleRowClick}
              onContextMenu={onNodeContext}
              refreshKey={refreshKey}
              controls={controls}
            />
          ))}

        </RootDroppable>
      </div>

      {/* 菜单与对话框放隐藏容器之外:面板未激活时(如命令面板发起「添加文件夹」)也可见 */}
      {menu && <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />}
        {addRootOpen && (
          <AddRootDialog
            value={rootPathDraft}
            error={rootError}
            submitting={addingRoot}
            picking={pickingDirectory}
            onChange={(value) => { setRootPathDraft(value); setRootError(null); }}
            onPick={pickDirectory}
            onSubmit={addRoot}
            onClose={() => { if (!addingRoot && !pickingDirectory) setAddRootOpen(false); }}
          />
        )}

      {/* 拖动跟随物:小而不挡视野 —— 单个 = 图标牌,多选 = 第一层数量徽标 */}
      <DragOverlay dropAnimation={null}>
        {activeNode ? (
          <DragPreview
            node={activeNode}
            count={multiSel.has(activeNode.id) ? pruneNested([...multiSel]).length : 1}
          />
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

function RootDroppable({
  children,
  onContextMenu,
  onNativeDragOver,
  onNativeDrop,
}: {
  children: React.ReactNode;
  onContextMenu: (e: React.MouseEvent) => void;
  /** 外部文件拖入(Finder → 树):dnd-kit 是指针拖拽,与原生 drag 事件不冲突。 */
  onNativeDragOver?: (e: React.DragEvent) => void;
  onNativeDrop?: (e: React.DragEvent) => void;
}) {
  // 仍注册 droppable:空白区是合法的悬停区域(无目标,不亮、放下无操作)
  const { setNodeRef } = useDroppable({ id: ROOT_ID });
  return (
    <div
      ref={setNodeRef}
      className="flex-1 overflow-y-auto"
      onContextMenu={onContextMenu}
      onDragOver={onNativeDragOver}
      onDrop={onNativeDrop}
    >
      {children}
    </div>
  );
}

/** 拖拽跟随物:不遮视野 —— 单个 = 小图标牌;多选 = 第一层数量徽标(Finder 习惯)。 */
function DragPreview({ node, count = 1 }: { node: FileNode; count?: number }) {
  if (count > 1) {
    return (
      <div className="w-7 h-7 rounded-full bg-accent text-white text-[12px] font-semibold flex items-center justify-center shadow-lg shadow-black/20 cursor-grabbing select-none">
        {count}
      </div>
    );
  }
  const Icon = fileIconFor(node.kind, node.title);
  return (
    <div className="w-7 h-7 rounded-md bg-surface border border-border-strong shadow-lg shadow-black/15 flex items-center justify-center cursor-grabbing select-none">
      <Icon size={14} className={fileColorFor(node.kind)} />
    </div>
  );
}

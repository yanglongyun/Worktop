import { type FileNode, filesApi } from "../../../api/files";
import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronRight } from "../../ui/icons";
import { fileIconFor, fileColorFor } from "../../files/icons";
import { useDraggable, useDroppable } from "@dnd-kit/core";

export type TreeControls = {
  /** 菜单遮罩会结束 CSS hover,菜单打开期间仍标明操作对象。 */
  contextMenuId: string | null;
  expandedIds: Set<string>;
  toggleExpand: (id: string) => void;
  setExpanded: (id: string, on: boolean) => void;
  // 创建
  creatingUnder: string | null;
  creatingKind: "folder" | "file";
  draftTitle: string;
  setDraftTitle: (s: string) => void;
  commitCreate: () => void;
  cancelCreate: () => void;
  // 重命名
  renamingId: string | null;
  renameDraft: string;
  setRenameDraft: (s: string) => void;
  commitRename: () => void;
  cancelRename: () => void;
  // dnd-kit:当前拖拽物 id + 将被落入的目标目录 id(该目录整行亮起)
  activeId: string | null;
  overDirId: string | null;
  /** 多选集(Cmd 点选 / Shift 范围选,VS Code 资源管理器同款);高亮与单选同款。 */
  multiSelectedIds: Set<string>;
  /** 剪切标记:进了剪贴板等待移动的行,半透明提示。 */
  cutIds: Set<string>;
  /** 行注册表:渲染时登记 FileNode 对象,键盘操作按 id 反查。 */
  registerNode: (n: FileNode) => void;
  /** Git 标记:files = absPath→status(文件染色+字母),dirs = 含变更的目录(点标)。 */
  gitMarks: { files: Map<string, string>; dirs: Set<string> };
};

/** Git 状态 → 颜色与字母(VS Code 习惯:U 新增绿 / M 修改橙 / A 已暂存绿 / C 冲突红)。 */
const gitBadge = (status?: string): { color: string; letter: string } | null => {
  if (!status) return null;
  if (status === "untracked") return { color: "text-success", letter: "U" };
  if (status === "conflict") return { color: "text-danger", letter: "C" };
  if (status === "staged") return { color: "text-success", letter: "A" };
  return { color: "text-warning", letter: "M" }; // modified / staged+modified / changed
};

export function NodeRow({
  node,
  selectedId,
  onRowClick,
  onContextMenu,
  refreshKey,
  controls,
  depth = 0,
}: {
  node: FileNode;
  selectedId: string;
  /** 点击交给父级裁决:普通点击=选中(+文件夹展开),Cmd/Shift=多选,行为在 NodeTree。 */
  onRowClick: (e: React.MouseEvent, n: FileNode) => void;
  onContextMenu: (e: React.MouseEvent, n: FileNode) => void;
  refreshKey: number;
  controls: TreeControls;
  depth?: number;
}) {
  const [children, setChildren] = useState<FileNode[]>([]);
  const [loaded, setLoaded] = useState(false);
  controls.registerNode(node); // 键盘操作按 id 反查 FileNode(ref 写入,渲染期安全)

  const isContainer = node.kind === "folder";
  const expanded = controls.expandedIds.has(node.id);
  const isRenaming = controls.renamingId === node.id;
  const isDragging = controls.activeId === node.id;
  const dragDisabled = isRenaming || !!node.isRoot;

  // dnd-kit
  const {
    attributes,
    listeners,
    setNodeRef: setDragRef,
  } = useDraggable({ id: node.id, data: { node }, disabled: dragDisabled });
  const { setNodeRef: setDropRef } = useDroppable({ id: node.id, data: { node } });
  const setRef = useCallback(
    (el: HTMLDivElement | null) => { setDragRef(el); setDropRef(el); },
    [setDragRef, setDropRef],
  );

  const isDropTarget = controls.overDirId === node.id;

  const loadChildren = useCallback(async () => {
    if (!isContainer) return;
    const result = await filesApi.listChildren(node.id);
    setChildren(result.items || []);
    setLoaded(true);
  }, [node.id, isContainer]);

  useEffect(() => { if (expanded && !loaded) loadChildren(); }, [expanded, loaded, loadChildren]);
  useEffect(() => { if (loaded || expanded) loadChildren(); }, [refreshKey]);

  const toggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isContainer) controls.toggleExpand(node.id);
  };

  const isSelected = selectedId === node.id || controls.multiSelectedIds.has(node.id);
  const Icon = fileIconFor(node.kind, node.title);
  const iconColor = fileColorFor(node.kind);
  const badge = !isContainer ? gitBadge(controls.gitMarks.files.get(node.id)) : null;
  const dirDirty = isContainer && controls.gitMarks.dirs.has(node.id);

  const showInputHere = isContainer && controls.creatingUnder === node.id;

  return (
    <div>
      <div
        ref={setRef}
        data-nid={node.id}
        {...(dragDisabled ? {} : attributes)}
        {...(dragDisabled ? {} : listeners)}
        role={dragDisabled ? "button" : undefined}
        tabIndex={dragDisabled ? 0 : undefined}
        onClick={(e) => {
          if (isRenaming) return;
          onRowClick(e, node);
        }}
        onContextMenu={(e) => onContextMenu(e, node)}
        className={[
          "group relative flex items-center gap-1.5 py-[3px] pr-2 cursor-pointer select-none text-text touch-none",
          isSelected && !isRenaming ? "bg-bg-inset" : controls.contextMenuId === node.id ? "bg-bg-hover" : "hover:bg-bg-hover",
          isDragging ? "opacity-40" : "",
          controls.cutIds.has(node.id) ? "opacity-50" : "", // 剪切待移动
          isDropTarget ? "drop-target" : "",
        ].join(" ")}
        style={{ paddingLeft: `${depth * 0.9 + 0.5}rem` }}
      >
        <span
          onClick={toggle}
          className={[
            "w-4 h-4 flex items-center justify-center shrink-0 transition-transform duration-150 rounded hover:bg-bg-inset",
            expanded ? "rotate-90" : "",
            isContainer ? "" : "invisible",
          ].join(" ")}
        >
          <ChevronRight size={12} className="text-text-faint" />
        </span>

        <Icon size={14} className={`shrink-0 ${iconColor}`} />

        {isRenaming ? (
          <input
            autoFocus
            ref={(el) => {
              // 打开即选中文件名主体(不含扩展名),VS Code 同款
              if (el && !el.dataset.sel) {
                el.dataset.sel = "1";
                const dot = el.value.lastIndexOf(".");
                el.setSelectionRange(0, dot > 0 ? dot : el.value.length);
              }
            }}
            value={controls.renameDraft}
            onChange={(e) => controls.setRenameDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") controls.commitRename();
              if (e.key === "Escape") controls.cancelRename();
            }}
            onBlur={controls.commitRename}
            onClick={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
            className="flex-1 min-w-0 bg-surface border border-accent rounded px-1 -mx-1 py-px text-[14px] text-text outline-none"
          />
        ) : (
          <span className={`flex-1 min-w-0 truncate text-[14.5px] ${badge?.color || ""}`}>{node.title}</span>
        )}

        {badge && <span className={`shrink-0 text-[11px] font-semibold ${badge.color}`}>{badge.letter}</span>}
        {dirDirty && <span className="shrink-0 w-1.5 h-1.5 rounded-full bg-warning/70" title="目录内有未提交变更" />}

        {/* 更多操作:桌面 hover / 移动端常驻。快速点弹菜单,不与按住拖拽冲突 */}
        <button
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => { e.stopPropagation(); onContextMenu(e, node); }}
          className="shrink-0 w-5 h-5 rounded flex items-center justify-center text-text-faint hover:text-text hover:bg-bg-inset opacity-0 group-hover:opacity-100 max-md:opacity-60"
          title="更多操作"
        >
          <span className="text-[15px] leading-none -mt-1">⋯</span>
        </button>
      </div>

      {expanded && isContainer && (
        <div>
          {showInputHere && <InlineCreateRow depth={depth + 1} controls={controls} />}
          {children.map((child) => (
            <NodeRow
              key={child.id}
              node={child}
              selectedId={selectedId}
              onRowClick={onRowClick}
              onContextMenu={onContextMenu}
              refreshKey={refreshKey}
              controls={controls}
              depth={depth + 1}
            />
          ))}
          {loaded && children.length === 0 && !showInputHere && (
            <div
              className="text-[11px] text-text-faint py-1"
              style={{ paddingLeft: `${(depth + 1) * 0.9 + 1.75}rem` }}
            >
              空
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function InlineCreateRow({ depth, controls }: { depth: number; controls: TreeControls }) {
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { inputRef.current?.focus(); }, []);

  const Icon = fileIconFor(controls.creatingKind);
  const iconColor = fileColorFor(controls.creatingKind);

  return (
    <div
      className="flex items-center gap-1.5 py-[3px] pr-2"
      style={{ paddingLeft: `${depth * 0.9 + 0.5}rem` }}
    >
      <span className="w-4 h-4 shrink-0" />
      <Icon size={14} className={`shrink-0 ${iconColor}`} />
      <input
        ref={inputRef}
        value={controls.draftTitle}
        onChange={(e) => controls.setDraftTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") controls.commitCreate();
          if (e.key === "Escape") controls.cancelCreate();
        }}
        onBlur={controls.commitCreate}
        placeholder={controls.creatingKind === "file" ? "文件名…" : "文件夹名…"}
        className="flex-1 min-w-0 bg-surface border border-accent rounded px-1 -mx-1 py-px text-[14px] text-text outline-none placeholder:text-text-faint"
      />
    </div>
  );
}

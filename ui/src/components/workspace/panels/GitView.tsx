import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { Check, ChevronRight, Copy, GitBranch, GitCommitHorizontal, GitCompare, GitPullRequest, History, Minus, Plus, RefreshCw, RotateCcw, UploadCloud } from "lucide-react";
import { api, type GitBranches, type GitCommitFile, type GitCommitInfo, type GitFileStatus, type GitRepositoryStatus } from "../../../api";
import { ContextMenu, dialog, type MenuItem } from "../../ui";

const statusText: Record<GitFileStatus["status"], string> = {
  untracked: "U",
  "staged+modified": "SM",
  staged: "S",
  modified: "M",
  changed: "C",
  conflict: "!",
};

const statusClass: Record<GitFileStatus["status"], string> = {
  untracked: "text-success",
  "staged+modified": "text-warning",
  staged: "text-accent",
  modified: "text-warning",
  changed: "text-text-faint",
  conflict: "text-danger",
};

type GitViewProps = {
  repoPath?: string;
  repoTitle?: string;
  refreshKey?: number;
  onOpenDiff?: (root: string, path: string, staged?: boolean, commit?: string) => void;
  onChanged?: () => void;
};

export function GitView({ repoPath, repoTitle, refreshKey = 0, onOpenDiff, onChanged }: GitViewProps) {
  const [repositories, setRepositories] = useState<GitRepositoryStatus[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [messageByRoot, setMessageByRoot] = useState<Record<string, string>>({});
  const [branchByRoot, setBranchByRoot] = useState<Record<string, GitBranches>>({});
  const [collapsedByRoot, setCollapsedByRoot] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // 历史:按仓库懒加载;点提交展开它动过的文件
  const [historyByRoot, setHistoryByRoot] = useState<Record<string, GitCommitInfo[] | null>>({});
  const [openCommit, setOpenCommit] = useState<string | null>(null);
  const [commitFiles, setCommitFiles] = useState<Record<string, GitCommitFile[]>>({});

  const toggleHistory = async (root: string) => {
    if (historyByRoot[root] !== undefined) {
      setHistoryByRoot((prev) => { const next = { ...prev }; delete next[root]; return next; });
      return;
    }
    setHistoryByRoot((prev) => ({ ...prev, [root]: null }));
    try {
      const { commits } = await api.gitLog(root);
      setHistoryByRoot((prev) => ({ ...prev, [root]: commits }));
    } catch (e: any) {
      setError(e?.message || "读取历史失败");
      setHistoryByRoot((prev) => { const next = { ...prev }; delete next[root]; return next; });
    }
  };

  const toggleCommit = async (root: string, hash: string) => {
    if (openCommit === hash) { setOpenCommit(null); return; }
    setOpenCommit(hash);
    if (!commitFiles[hash]) {
      try {
        const { files } = await api.gitShow(root, hash);
        setCommitFiles((prev) => ({ ...prev, [hash]: files }));
      } catch (e: any) {
        setError(e?.message || "读取提交失败");
      }
    }
  };

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      if (repoPath) {
        const result = await api.gitRepository(repoPath);
        setRepositories(result.repository ? [result.repository] : []);
      } else {
        const result = await api.gitStatus();
        setRepositories(result.repositories || []);
      }
    } catch (e: any) {
      setError(e.message || "读取 Git 状态失败");
      setRepositories([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [repoPath, refreshKey]);

  const updateRepo = (repo: GitRepositoryStatus) => {
    setRepositories((current) => current.map((item) => item.root === repo.root || item.workspaceId === repo.workspaceId ? repo : item));
    onChanged?.();
  };

  const run = async (label: string, fn: () => Promise<{ repository?: GitRepositoryStatus; output?: string }>) => {
    setBusy(label);
    setError(null);
    setNotice(null);
    try {
      const result = await fn();
      if (result.repository) updateRepo(result.repository);
      setNotice(result.output || "完成");
    } catch (e: any) {
      setError(e.message || "Git 操作失败");
    } finally {
      setBusy(null);
    }
  };

  const loadBranches = async (root: string) => {
    setBusy(`branches:${root}`);
    setError(null);
    try {
      const result = await api.gitBranches(root);
      setBranchByRoot((current) => ({ ...current, [root]: result }));
    } catch (e: any) {
      setError(e.message || "读取分支失败");
    } finally {
      setBusy(null);
    }
  };

  const repos = repositories.filter((repo) => repo.isRepo);
  const singleRepo = !!repoPath;
  const panelWidth = singleRepo ? "mx-auto w-full max-w-4xl px-5 md:px-8" : "w-full";

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className="border-b border-border">
        <div className={["flex items-center gap-2", panelWidth].join(" ")}>
          <GitBranch size={15} className="text-accent" />
          <span className="flex-1 min-w-0 text-[13px] font-semibold text-text">{repoTitle || "源代码管理"}</span>
          <button
            onClick={load}
            className="my-2 w-6 h-6 flex items-center justify-center text-text-faint hover:text-text hover:bg-bg-hover disabled:opacity-50"
            disabled={loading || !!busy}
            title="刷新"
          >
            <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
          </button>
        </div>
      </div>

      {(error || notice) && (
        <div className={[singleRepo ? "mx-auto w-full max-w-4xl px-5 md:px-8" : "mx-2", "mt-2"].join(" ")}>
          <div className={["px-2 py-1.5 text-[12px]", error ? "bg-danger/10 text-danger" : "bg-success/10 text-success"].join(" ")}>
            {error || notice}
          </div>
        </div>
      )}

      <div className={["flex-1 min-h-0 overflow-y-auto", singleRepo ? "" : "py-1"].join(" ")}>
        {repos.length === 0 && (
          <div className={["px-4 py-10 text-center text-[13px] text-text-faint", panelWidth].join(" ")}>没有 Git 仓库</div>
        )}
        {repos.map((repo) => (
          <RepositoryBlock
            key={`${repo.workspaceId}:${repo.root}`}
            repo={repo}
            busy={busy}
            singleRepo={singleRepo}
            expanded={singleRepo || !collapsedByRoot[repo.root || repo.workspaceId]}
            commitMessage={messageByRoot[repo.root || ""] || ""}
            branches={repo.root ? branchByRoot[repo.root] : undefined}
            onToggleExpanded={() => {
              const key = repo.root || repo.workspaceId;
              setCollapsedByRoot((current) => ({ ...current, [key]: !current[key] }));
            }}
            onMessageChange={(message) => setMessageByRoot((current) => ({ ...current, [repo.root || ""]: message }))}
            onOpenDiff={onOpenDiff}
            onLoadBranches={() => repo.root && loadBranches(repo.root)}
            onRun={run}
            history={repo.root !== null && repo.root !== undefined ? historyByRoot[repo.root] : undefined}
            onToggleHistory={() => repo.root && toggleHistory(repo.root)}
            openCommit={openCommit}
            commitFiles={commitFiles}
            onToggleCommit={(hash) => repo.root && toggleCommit(repo.root, hash)}
          />
        ))}
      </div>
    </div>
  );
}

function RepositoryBlock({
  repo,
  busy,
  singleRepo,
  expanded,
  commitMessage,
  branches,
  onToggleExpanded,
  onMessageChange,
  onOpenDiff,
  onLoadBranches,
  onRun,
  history,
  onToggleHistory,
  openCommit,
  commitFiles,
  onToggleCommit,
}: {
  repo: GitRepositoryStatus;
  busy: string | null;
  singleRepo?: boolean;
  expanded: boolean;
  commitMessage: string;
  branches?: GitBranches;
  onToggleExpanded: () => void;
  onMessageChange: (message: string) => void;
  onOpenDiff?: (root: string, path: string, staged?: boolean, commit?: string) => void;
  onLoadBranches: () => void;
  onRun: (label: string, fn: () => Promise<{ repository?: GitRepositoryStatus; output?: string }>) => Promise<void>;
  /** undefined = 收着;null = 加载中;数组 = 已加载 */
  history?: GitCommitInfo[] | null;
  onToggleHistory: () => void;
  openCommit: string | null;
  commitFiles: Record<string, GitCommitFile[]>;
  onToggleCommit: (hash: string) => void;
}) {
  const root = repo.root || "";
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);
  const conflicts = useMemo(() => repo.files.filter((file) => file.status === "conflict"), [repo.files]);
  const staged = useMemo(() => repo.files.filter((file) => file.staged && file.status !== "conflict"), [repo.files]);
  const unstaged = useMemo(
    () => repo.files.filter((file) => file.status !== "conflict" && (file.unstaged || file.status === "untracked")),
    [repo.files],
  );
  const hasConflict = conflicts.length > 0;
  const disabled = !!busy || !root;
  const showDetails = singleRepo || expanded;

  const doDiscard = async (file: GitFileStatus) => {
    if (!(await dialog.confirm(`丢弃「${file.path}」的更改?\n这个操作不可撤销。`, { danger: true, confirmText: "丢弃" }))) return;
    onRun(`discard:${file.path}`, () => api.gitDiscard({ root, path: file.path }));
  };
  const toggleGroup = (id: string) =>
    setCollapsedGroups((current) => ({ ...current, [id]: !current[id] }));
  const copyPath = async (file: GitFileStatus) => {
    try { await navigator.clipboard.writeText(file.path); }
    catch {
      const ta = document.createElement("textarea");
      ta.value = file.path;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    }
  };
  const openFileMenu = (e: React.MouseEvent, file: GitFileStatus, stagedDiff: boolean) => {
    e.preventDefault();
    e.stopPropagation();
    const items: MenuItem[] = [
      { label: stagedDiff ? "打开暂存更改" : "打开更改", icon: <GitCompare size={13} />, onClick: () => onOpenDiff?.(root, file.path, stagedDiff) },
      "divider",
    ];
    if (file.staged) {
      items.push({ label: "取消暂存", icon: <Minus size={13} />, onClick: () => onRun(`unstage:${file.path}`, () => api.gitUnstage({ root, path: file.path })) });
    }
    if ((file.unstaged || file.status === "untracked") && file.status !== "conflict") {
      items.push({ label: "暂存更改", icon: <Plus size={13} />, onClick: () => onRun(`stage:${file.path}`, () => api.gitStage({ root, path: file.path })) });
    }
    items.push(
      { label: "复制路径", icon: <Copy size={13} />, onClick: () => copyPath(file) },
      "divider",
      { label: "丢弃更改", icon: <RotateCcw size={13} />, danger: true, onClick: () => doDiscard(file) },
    );
    setMenu({ x: e.clientX, y: e.clientY, items });
  };

  return (
    <section className={singleRepo ? "mx-auto w-full max-w-4xl px-5 py-6 md:px-8" : "border-b border-border pb-2 mb-2"}>
      {!singleRepo && (
        <button
          onClick={onToggleExpanded}
          className="w-full px-3 py-2 text-left hover:bg-bg-hover"
          title={expanded ? "收起仓库" : "展开仓库"}
        >
          <div className="flex items-center gap-1.5">
            <ChevronRight
              size={13}
              className={[
                "text-text-faint shrink-0 transition-transform",
                expanded ? "rotate-90" : "",
              ].join(" ")}
            />
            <GitBranch size={13} className="text-accent shrink-0" />
            <span className="flex-1 min-w-0 truncate text-[13px] font-semibold text-text">{repo.workspaceTitle}</span>
            <span className="text-[11px] text-text-faint tabular-nums">{repo.files.length}</span>
          </div>
          <div className="mt-1 flex items-center gap-1.5 text-[11px] text-text-faint min-w-0">
            <button
              onClick={(e) => { e.stopPropagation(); onLoadBranches(); }}
              className="truncate hover:text-text"
              title="分支"
            >
              {repo.branch || "HEAD"}
            </button>
            {repo.ahead > 0 && <span className="shrink-0">↑{repo.ahead}</span>}
            {repo.behind > 0 && <span className="shrink-0">↓{repo.behind}</span>}
            {hasConflict && <span className="shrink-0 text-danger">冲突</span>}
          </div>
        </button>
      )}

      {singleRepo && (
        <div className="mb-3 flex items-center gap-2">
          <button
            onClick={onLoadBranches}
            disabled={disabled}
            className="h-7 min-w-0 flex items-center gap-1.5 border border-border bg-bg px-2 text-left text-[12px] text-text-dim hover:bg-bg-hover hover:text-text disabled:opacity-50"
            title="分支"
          >
            <GitBranch size={12} className="text-text-faint shrink-0" />
            <span className="truncate">
              {repo.branch || "HEAD"}
            </span>
          </button>
          <div className="min-w-0 flex-1 flex items-center gap-2 text-[11.5px] text-text-faint">
            <span className="shrink-0 tabular-nums">{repo.files.length} 个变更</span>
            {repo.ahead > 0 && <span className="shrink-0">领先 {repo.ahead}</span>}
            {repo.behind > 0 && <span className="shrink-0">落后 {repo.behind}</span>}
            {hasConflict && <span className="shrink-0 text-danger">冲突</span>}
          </div>
        </div>
      )}

      {showDetails && branches && (
        <div className={["mb-2 border border-border bg-bg", singleRepo ? "" : "mx-2"].join(" ")}>
          <div className="max-h-32 overflow-y-auto py-1">
            {branches.branches.map((branch) => (
              <button
                key={branch}
                onClick={() => onRun(`checkout:${branch}`, () => api.gitCheckout({ root, branch }))}
                disabled={disabled || branch === branches.current}
                className="w-full flex items-center gap-1.5 px-2 py-1 text-left text-[12px] hover:bg-bg-hover disabled:opacity-50"
              >
                <GitBranch size={12} className="text-text-faint" />
                <span className="truncate">{branch}</span>
                {branch === branches.current && <Check size={12} className="ml-auto text-success" />}
              </button>
            ))}
          </div>
        </div>
      )}

      {showDetails && (
        <>
          <div className={singleRepo ? "pb-3" : "px-2 pb-2"}>
            <textarea
              value={commitMessage}
              onChange={(e) => onMessageChange(e.target.value)}
              placeholder="提交消息"
              rows={3}
              className="w-full resize-none border border-border bg-bg px-2 py-1.5 text-[12.5px] text-text outline-none focus:border-accent"
            />
            <div className="mt-1.5 flex items-center gap-2">
              <span className="flex-1 min-w-0 text-[11.5px] text-text-faint">
                {staged.length ? `已暂存 ${staged.length} 项` : "暂存后提交"}
              </span>
              <button
                onClick={() => onRun("commit", async () => {
                  const result = await api.gitCommit({ root, message: commitMessage });
                  onMessageChange("");
                  return result;
                })}
                disabled={disabled || !commitMessage.trim() || staged.length === 0 || hasConflict}
                className="h-7 flex items-center justify-center gap-1.5 px-3 text-[12.5px] bg-accent text-white hover:opacity-90 disabled:opacity-40"
              >
                <GitCommitHorizontal size={13} /> 提交
              </button>
            </div>
          </div>

          <div className={singleRepo ? "pb-3 flex items-center gap-1.5" : "px-2 pb-2 grid grid-cols-3 gap-1"}>
            <GitAction label="Fetch" icon={<RefreshCw size={12} />} disabled={disabled} onClick={() => onRun("fetch", () => api.gitRemote({ root, action: "fetch" }))} />
            <GitAction label="Pull" icon={<GitPullRequest size={12} />} disabled={disabled} onClick={() => onRun("pull", () => api.gitRemote({ root, action: "pull" }))} />
            <GitAction label="Push" icon={<UploadCloud size={12} />} disabled={disabled} onClick={() => onRun("push", () => api.gitRemote({ root, action: "push" }))} />
          </div>

          <ChangeGroup
            title="合并更改"
            count={conflicts.length}
            files={conflicts}
            root={root}
            collapsed={!!collapsedGroups.conflicts}
            disabled={disabled}
            onToggle={() => toggleGroup("conflicts")}
            onOpenDiff={onOpenDiff}
            onContextMenu={openFileMenu}
          />
          <ChangeGroup
            title="暂存的更改"
            count={staged.length}
            files={staged}
            root={root}
            staged
            collapsed={!!collapsedGroups.staged}
            disabled={disabled}
            onToggle={() => toggleGroup("staged")}
            onOpenDiff={onOpenDiff}
            onAction={(file) => onRun(`unstage:${file.path}`, () => api.gitUnstage({ root, path: file.path }))}
            actionIcon={<Minus size={12} />}
            actionTitle="取消暂存"
            onContextMenu={openFileMenu}
            groupAction={staged.length ? { title: "全部取消暂存", onClick: () => onRun("unstage-all", () => api.gitUnstage({ root, all: true })) } : undefined}
          />
          <ChangeGroup
            title="更改"
            count={unstaged.length}
            files={unstaged}
            root={root}
            collapsed={!!collapsedGroups.changes}
            disabled={disabled}
            onToggle={() => toggleGroup("changes")}
            onOpenDiff={onOpenDiff}
            onAction={(file) => onRun(`stage:${file.path}`, () => api.gitStage({ root, path: file.path }))}
            actionIcon={<Plus size={12} />}
            actionTitle="暂存"
            onDiscard={doDiscard}
            onContextMenu={openFileMenu}
            groupAction={unstaged.length ? { title: "全部暂存", onClick: () => onRun("stage-all", () => api.gitStage({ root, all: true })) } : undefined}
          />
          {repo.files.length === 0 && (
            <div className="px-3 py-2 text-[12px] text-text-faint">没有未提交的更改</div>
          )}

          {/* ── 历史:懒加载最近 50 条,点提交看它动过的文件,点文件开该提交的对照视图 ── */}
          <div className="pb-1 border-t border-border mt-1">
            <button
              onClick={onToggleHistory}
              className="h-7 w-full flex items-center gap-1.5 px-3 text-left text-[11px] font-semibold uppercase text-text-faint hover:bg-bg-hover"
            >
              <ChevronRight size={12} className={["transition-transform", history !== undefined ? "rotate-90" : ""].join(" ")} />
              <History size={11} /> 历史
            </button>
            {history === null && <div className="px-3 py-1.5 text-[12px] text-text-faint">读取中…</div>}
            {Array.isArray(history) && !history.length && (
              <div className="px-3 py-1.5 text-[12px] text-text-faint">还没有提交</div>
            )}
            {Array.isArray(history) && history.map((c) => (
              <div key={c.hash}>
                <button
                  onClick={() => onToggleCommit(c.hash)}
                  title={`${c.subject}
${c.author} · ${c.date} · ${c.short}`}
                  className="w-full flex items-center gap-2 px-3 py-[3px] text-left hover:bg-bg-hover"
                >
                  <GitCommitHorizontal size={12} className="shrink-0 text-text-faint" />
                  <span className="flex-1 min-w-0 truncate text-[12.5px] text-text">{c.subject}</span>
                  <span className="shrink-0 text-[10.5px] text-text-faint font-mono">{c.short}</span>
                </button>
                {openCommit === c.hash && (
                  <div className="pb-1">
                    <div className="px-3 pl-8 py-0.5 text-[10.5px] text-text-faint">{c.author} · {c.date}</div>
                    {(commitFiles[c.hash] || []).map((f) => (
                      <button
                        key={f.path}
                        onClick={() => onOpenDiff?.(root, f.path, false, c.hash)}
                        title={`查看该提交里 ${f.path} 的改动`}
                        className="w-full flex items-center gap-2 pl-8 pr-3 py-[2px] text-left hover:bg-bg-hover"
                      >
                        <span className={["shrink-0 w-3 text-[10.5px] font-mono", f.status === "A" ? "text-success" : f.status === "D" ? "text-danger" : "text-warning"].join(" ")}>{f.status}</span>
                        <span className="flex-1 min-w-0 truncate text-[12px] text-text-dim">{f.path}</span>
                      </button>
                    ))}
                    {!commitFiles[c.hash] && <div className="pl-8 py-1 text-[11.5px] text-text-faint">读取中…</div>}
                  </div>
                )}
              </div>
            ))}
          </div>
        </>
      )}
      {menu && <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />}
    </section>
  );
}

function ChangeGroup({
  title,
  count,
  files,
  root,
  staged = false,
  collapsed,
  disabled,
  actionIcon,
  actionTitle,
  groupAction,
  onToggle,
  onOpenDiff,
  onAction,
  onDiscard,
  onContextMenu,
}: {
  title: string;
  count: number;
  files: GitFileStatus[];
  root: string;
  staged?: boolean;
  collapsed: boolean;
  disabled?: boolean;
  actionIcon?: ReactNode;
  actionTitle?: string;
  groupAction?: { title: string; onClick: () => void };
  onToggle: () => void;
  onOpenDiff?: (root: string, path: string, staged?: boolean, commit?: string) => void;
  onAction?: (file: GitFileStatus) => void;
  onDiscard?: (file: GitFileStatus) => void;
  onContextMenu?: (e: React.MouseEvent, file: GitFileStatus, staged: boolean) => void;
}) {
  if (!count) return null;
  return (
    <div className="pb-1">
      <button
        onClick={onToggle}
        className="h-7 w-full flex items-center gap-1.5 px-3 text-left text-[11px] font-semibold uppercase text-text-faint hover:bg-bg-hover"
        title={collapsed ? `展开${title}` : `收起${title}`}
      >
        <ChevronRight
          size={12}
          className={[
            "shrink-0 transition-transform",
            collapsed ? "" : "rotate-90",
          ].join(" ")}
        />
        <span className="flex-1 min-w-0 truncate">{title}</span>
        <span className="tabular-nums">{count}</span>
        {groupAction && (
          <span
            onClick={(e) => { e.stopPropagation(); groupAction.onClick(); }}
            className="text-text-faint hover:text-text normal-case"
            title={groupAction.title}
          >
            {groupAction.title}
          </span>
        )}
      </button>
      {!collapsed && files.map((file) => (
        <div key={`${title}:${file.path}`} className="group flex items-center gap-1 px-2 hover:bg-bg-hover">
          <button
            onClick={() => onOpenDiff?.(root, file.path, staged)}
            onContextMenu={(e) => onContextMenu?.(e, file, staged)}
            className="min-w-0 flex-1 flex items-center gap-2 py-1 text-left"
            title={file.path}
          >
            <span className={["w-6 shrink-0 text-[11px] font-semibold tabular-nums", statusClass[file.status]].join(" ")}>
              {statusText[file.status]}
            </span>
            <span className="flex-1 min-w-0 truncate text-[12.5px] text-text-dim">{file.path}</span>
          </button>
          {onAction && actionIcon && actionTitle && (
            <button
              onClick={() => onAction(file)}
              disabled={disabled || file.status === "conflict"}
              className="w-5 h-5 hidden max-md:flex group-hover:flex items-center justify-center text-text-faint hover:text-text disabled:opacity-40"
              title={actionTitle}
            >
              {actionIcon}
            </button>
          )}
          {onDiscard && (
            <button
              onClick={() => onDiscard(file)}
              disabled={disabled}
              className="w-5 h-5 hidden max-md:flex group-hover:flex items-center justify-center text-text-faint hover:text-danger disabled:opacity-40"
              title="丢弃"
            >
              <RotateCcw size={12} />
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

function GitAction({
  label,
  icon,
  disabled,
  onClick,
}: {
  label: string;
  icon: ReactNode;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="flex items-center justify-center gap-1 px-1.5 py-1 text-[11.5px] bg-bg-hover text-text-dim hover:text-text hover:bg-bg-inset disabled:opacity-40"
    >
      {icon}
      {label}
    </button>
  );
}

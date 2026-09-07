import { type GitFileStatus, gitApi } from "../../../api/git";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { Copy, GitCompare, Minus, Plus, RefreshCw, RotateCcw } from "lucide-react";
import { DiffView } from "../../files/DiffView";
import { dialog } from "../../ui";
import type { GitDiffTab } from "../types";

type GitDiffPanelProps = {
  tab: GitDiffTab;
  refreshKey?: number;
  onChanged?: () => void;
};

export function GitDiffPanel({ tab, refreshKey = 0, onChanged }: GitDiffPanelProps) {
  const [pair, setPair] = useState<{ before: string; after: string; binary: boolean } | null>(null);
  const [fileStatus, setFileStatus] = useState<GitFileStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await gitApi.gitDiff({ root: tab.root, path: tab.path, staged: tab.staged, commit: tab.commit });
      let file: GitFileStatus | null = null;
      if (!tab.commit) {
        const status = await gitApi.gitStatus();
        const repo = status.repositories.find((item) => item.root === tab.root);
        file = repo?.files.find((item) => item.path === tab.path || item.originalPath === tab.path) || null;
      }
      setPair(result);
      setFileStatus(file);
    } catch (e: any) {
      setPair(null);
      setFileStatus(null);
      setError(e.message || "读取 diff 失败");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [tab.root, tab.path, tab.staged, tab.commit, refreshKey]);

  const canStage = !tab.commit && !tab.staged && fileStatus?.status !== "conflict" && !!(fileStatus?.unstaged || fileStatus?.status === "untracked");
  const canUnstage = !!tab.staged && !!fileStatus?.staged;
  const canDiscard = !tab.commit && !tab.staged && fileStatus?.status !== "conflict" && !!(fileStatus?.unstaged || fileStatus?.status === "untracked");
  const disabled = loading || !!busy;

  const runAction = async (label: string, fn: () => Promise<unknown>) => {
    setBusy(label);
    setError(null);
    setNotice(null);
    try {
      await fn();
      setNotice("完成");
      onChanged?.();
      await load();
    } catch (e: any) {
      setError(e.message || "Git 操作失败");
    } finally {
      setBusy(null);
    }
  };

  const copyPath = async () => {
    try { await navigator.clipboard.writeText(tab.path); }
    catch {
      const ta = document.createElement("textarea");
      ta.value = tab.path;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    }
    setNotice("已复制路径");
  };

  const discard = async () => {
    if (!(await dialog.confirm(`丢弃「${tab.path}」的更改?\n这个操作不可撤销。`, { danger: true, confirmText: "丢弃" }))) return;
    runAction("discard", () => gitApi.gitDiscard({ root: tab.root, path: tab.path }));
  };

  return (
    <div className="flex-1 min-h-0 flex flex-col bg-bg">
      <div className="h-10 px-3 border-b border-border bg-bg-raised flex items-center gap-2 shrink-0">
        <GitCompare size={15} className="text-accent" />
        <span className="flex-1 min-w-0 truncate text-[13px] font-semibold text-text">{tab.path}</span>
        {fileStatus && <span className="shrink-0 text-[11px] px-1.5 py-0.5 bg-bg-hover text-text-faint">{fileStatus.status}</span>}
        {tab.staged && <span className="shrink-0 text-[11px] px-1.5 py-0.5 bg-accent-soft text-accent">staged</span>}
        {canStage && (
          <DiffActionButton
            title="暂存更改"
            disabled={disabled}
            onClick={() => runAction("stage", () => gitApi.gitStage({ root: tab.root, path: tab.path }))}
          >
            <Plus size={13} />
          </DiffActionButton>
        )}
        {canUnstage && (
          <DiffActionButton
            title="取消暂存"
            disabled={disabled}
            onClick={() => runAction("unstage", () => gitApi.gitUnstage({ root: tab.root, path: tab.path }))}
          >
            <Minus size={13} />
          </DiffActionButton>
        )}
        {canDiscard && (
          <DiffActionButton title="丢弃更改" disabled={disabled} danger onClick={discard}>
            <RotateCcw size={13} />
          </DiffActionButton>
        )}
        <DiffActionButton title="复制路径" disabled={disabled} onClick={copyPath}>
          <Copy size={13} />
        </DiffActionButton>
        <button
          onClick={load}
          className="w-7 h-7 flex items-center justify-center text-text-faint hover:text-text hover:bg-bg-hover disabled:opacity-50"
          disabled={disabled}
          title="刷新 diff"
        >
          <RefreshCw size={13} className={loading || busy === "refresh" ? "animate-spin" : ""} />
        </button>
      </div>
      {(notice && !error) && <div className="px-3 py-1.5 text-[12px] text-success bg-success/10">{notice}</div>}
      {error ? (
        <div className="p-4 text-[13px] text-danger">{error}</div>
      ) : pair?.binary ? (
        <div className="p-4 text-[13px] text-text-faint">二进制文件,不展示文本差异</div>
      ) : !loading && pair && pair.before === pair.after ? (
        <div className="p-4 text-[13px] text-text-faint">没有可显示的差异</div>
      ) : pair ? (
        // 左 = 变更前,右 = 变更后:词级高亮 + 语法着色 + 未变段折叠(@codemirror/merge)
        <DiffView before={pair.before} after={pair.after} filename={tab.path} />
      ) : null}
    </div>
  );
}

function DiffActionButton({
  title,
  disabled,
  danger = false,
  onClick,
  children,
}: {
  title: string;
  disabled?: boolean;
  danger?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={[
        "w-7 h-7 flex items-center justify-center text-text-faint hover:bg-bg-hover disabled:opacity-50",
        danger ? "hover:text-danger" : "hover:text-text",
      ].join(" ")}
      title={title}
    >
      {children}
    </button>
  );
}

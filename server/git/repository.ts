// @ts-nocheck
import { execFileSync } from "child_process";
import fs from "fs";
import path from "path";
import { listRoots } from "../files/roots.js";

const runGit = (cwd, args, { allowError = false, input = undefined } = {}) => {
  try {
    return execFileSync("git", ["-C", cwd, ...args], {
      encoding: "utf8",
      input,
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 15000,
    }).trimEnd();
  } catch (error) {
    if (allowError) return String(error.stdout || "").trimEnd();
    const message = String(error.stderr || error.stdout || error.message || "git command failed").trim();
    throw new Error(message || "git command failed");
  }
};

const runGitMutation = (cwd, args) =>
  execFileSync("git", ["-C", cwd, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 30000,
  }).trimEnd();

const parseBranch = (line) => {
  const text = String(line || "").replace(/^##\s*/, "");
  const [namePart, metaPart = ""] = text.split(" [");
  const [branch = "", upstream = ""] = namePart.split("...");
  const ahead = Number(/\bahead\s+(\d+)/.exec(metaPart)?.[1] || 0);
  const behind = Number(/\bbehind\s+(\d+)/.exec(metaPart)?.[1] || 0);
  return { branch, upstream: upstream || null, ahead, behind };
};

const statusLabel = (x, y) => {
  if (x === "U" || y === "U" || (x === "A" && y === "A") || (x === "D" && y === "D")) return "conflict";
  if (x === "?" && y === "?") return "untracked";
  if (x !== " " && y !== " ") return "staged+modified";
  if (x !== " ") return "staged";
  if (y !== " ") return "modified";
  return "changed";
};

const parseFile = (line, topLevel) => {
  const x = line[0] || " ";
  const y = line[1] || " ";
  const raw = line.slice(3);
  const renamed = raw.includes(" -> ");
  const file = renamed ? raw.split(" -> ").pop() : raw;
  const originalPath = renamed ? raw.split(" -> ")[0] : null;
  return {
    path: file,
    absPath: path.join(topLevel, file),
    originalPath,
    index: x,
    worktree: y,
    status: statusLabel(x, y),
    renamed,
    staged: x !== " " && x !== "?",
    unstaged: y !== " " && y !== "?",
  };
};

const getRepositoryStatus = (fileRoot) => {
  try {
    const topLevel = runGit(fileRoot.path, ["rev-parse", "--show-toplevel"]);
    const output = runGit(fileRoot.path, ["status", "--porcelain=v1", "-b"]);
    const lines = output.split(/\r?\n/).filter(Boolean);
    const branch = parseBranch(lines[0] || "");
    const files = lines.slice(1).map((line) => parseFile(line, topLevel));
    return {
      fileRootId: fileRoot.id,
      fileRootTitle: fileRoot.title,
      fileRootPath: fileRoot.path,
      root: topLevel,
      isRepo: true,
      ...branch,
      files,
    };
  } catch {
    return {
      fileRootId: fileRoot.id,
      fileRootTitle: fileRoot.title,
      fileRootPath: fileRoot.path,
      root: null,
      isRepo: false,
      branch: null,
      upstream: null,
      ahead: 0,
      behind: 0,
      files: [],
    };
  }
};

const listGitRepositories = () => {
  const seen = new Set();
  const repos = [];
  for (const fileRoot of listRoots()) {
    const repo = getRepositoryStatus(fileRoot);
    const key = repo.root || `fileRoot:${repo.fileRootId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    repos.push(repo);
  }
  return repos;
};

const withSep = (abs) => abs.endsWith(path.sep) ? abs : abs + path.sep;
const isUnder = (abs, root) => abs === root || abs.startsWith(withSep(root));
const rootForAbs = (abs) =>
  listRoots()
    .map((fileRoot) => ({ ...fileRoot, path: path.resolve(fileRoot.path) }))
    .find((fileRoot) => isUnder(abs, fileRoot.path)) || null;

const repositoryStatusForPath = (rawPath) => {
  const abs = path.resolve(String(rawPath || ""));
  const fileRoot = rootForAbs(abs);
  if (!fileRoot) return null;
  let st; try { st = fs.statSync(abs); } catch { return null; }
  if (!st.isDirectory()) return null;
  const repo = getRepositoryStatus({
    id: fileRoot.id,
    title: path.basename(abs) || fileRoot.title,
    path: abs,
  });
  if (!repo.isRepo || repo.root !== abs) return null;
  if (repo.isRepo && repo.root) repo.fileRootTitle = path.basename(repo.root) || repo.fileRootTitle;
  return repo;
};

const repoByRoot = (root) => {
  const requestedRoot = path.resolve(String(root || ""));
  const repo = repositoryStatusForPath(requestedRoot);
  if (repo?.root === requestedRoot) return repo;
  if (repo?.root) throw new Error("git repository root mismatch");
  const known = listGitRepositories().find((item) => item.isRepo && item.root === requestedRoot);
  if (known) return known;
  throw new Error("git repository not found");
};

const refreshRepo = (repo) => getRepositoryStatus({
  id: repo.fileRootId,
  title: repo.fileRootTitle,
  path: repo.root,
});

const ensureRelativePath = (filePath) => {
  const value = String(filePath || "").trim();
  if (!value || path.isAbsolute(value) || value.split(/[\\/]/).includes("..")) throw new Error("invalid file path");
  return value;
};

// 两份完整内容(merge 视图用):unstaged 比「暂存区 vs 工作树」,staged 比「HEAD vs 暂存区」。
// 新文件/未跟踪 → before 为空;删除 → after 为空;含 \0 视为二进制,不出文本。
const gitDiff = ({ root, filePath, staged = false, commit = "" }) => {
  const repo = repoByRoot(root);
  const file = ensureRelativePath(filePath);
  const show = (ref) => runGit(repo.root, ["show", `${ref}:${file}`], { allowError: true });
  const readWorktree = () => {
    try { return fs.readFileSync(path.join(repo.root, file), "utf8").replace(/\n$/, ""); } catch { return ""; }
  };
  // 带 commit = 看历史:父提交 vs 该提交(根提交/新增文件 before 为空)
  const before = commit ? show(`${ensureHash(commit)}^`) : staged ? show("HEAD") : show(":0");
  const after = commit ? show(ensureHash(commit)) : staged ? show(":0") : readWorktree();
  if (before.includes("\u0000") || after.includes("\u0000")) return { before: "", after: "", binary: true };
  return { before, after, binary: false };
};

const SHA = /^[0-9a-f]{7,40}$/i;
const ensureHash = (value) => {
  const hash = String(value || "").trim();
  if (!SHA.test(hash)) throw new Error("invalid commit hash");
  return hash;
};

/** 提交历史:最近 N 条。 */
const gitLog = ({ root, limit = 50 }) => {
  const repo = repoByRoot(root);
  const n = Math.max(1, Math.min(Number(limit) || 50, 200));
  const SEP = "\u001f";
  const out = runGit(repo.root, [
    "log", `-${n}`, `--pretty=format:%H${SEP}%h${SEP}%an${SEP}%ad${SEP}%s`, "--date=format:%Y-%m-%d %H:%M",
  ], { allowError: true });
  const commits = out
    ? out.split(/\r?\n/).filter(Boolean).map((line) => {
        const [hash, short, author, date, ...rest] = line.split(SEP);
        return { hash, short, author, date, subject: rest.join(SEP) };
      })
    : [];
  return { commits };
};

/** 一次提交动了哪些文件。 */
const gitShow = ({ root, hash }) => {
  const repo = repoByRoot(root);
  const commit = ensureHash(hash);
  const out = runGit(repo.root, ["show", commit, "--name-status", "--pretty=format:", "-M"], { allowError: true });
  const files = out.split(/\r?\n/).filter(Boolean).map((line) => {
    const parts = line.split("\t");
    const status = parts[0][0];
    return status === "R" || status === "C"
      ? { status, path: parts[2], oldPath: parts[1] }
      : { status, path: parts[1], oldPath: null };
  });
  return { files };
};

const gitBranches = (root) => {
  const repo = repoByRoot(root);
  const current = runGit(repo.root, ["branch", "--show-current"]);
  const rows = runGit(repo.root, ["branch", "--format=%(refname:short)"]).split(/\r?\n/).filter(Boolean);
  return { current, branches: rows };
};

const gitStage = ({ root, filePath, all = false }) => {
  const repo = repoByRoot(root);
  if (all) runGitMutation(repo.root, ["add", "-A"]);
  else runGitMutation(repo.root, ["add", "--", ensureRelativePath(filePath)]);
  return refreshRepo(repo);
};

const gitUnstage = ({ root, filePath, all = false }) => {
  const repo = repoByRoot(root);
  if (all) runGitMutation(repo.root, ["reset"]);
  else runGitMutation(repo.root, ["reset", "HEAD", "--", ensureRelativePath(filePath)]);
  return refreshRepo(repo);
};

const gitDiscard = ({ root, filePath }) => {
  const repo = repoByRoot(root);
  const file = ensureRelativePath(filePath);
  const status = repo.files.find((item) => item.path === file);
  if (!status) return refreshRepo(repo);
  if (status.status === "untracked") {
    fs.rmSync(path.join(repo.root, file), { recursive: true, force: true });
  } else {
    runGitMutation(repo.root, ["restore", "--staged", "--worktree", "--", file]);
  }
  return refreshRepo(repo);
};

const gitCommit = ({ root, message }) => {
  const repo = repoByRoot(root);
  const msg = String(message || "").trim();
  if (!msg) throw new Error("commit message is required");
  const output = runGitMutation(repo.root, ["commit", "-m", msg]);
  return { output, repository: refreshRepo(repo) };
};

const gitRemoteAction = ({ root, action }) => {
  const repo = repoByRoot(root);
  const map = {
    fetch: ["fetch"],
    pull: ["pull", "--ff-only"],
    push: ["push"],
  };
  let args = map[action];
  if (!args) throw new Error("unknown git remote action");
  if (action === "push") {
    // 新分支没有上游:git push 裸跑会拒 —— 自动 -u origin <branch>
    const upstream = runGit(repo.root, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"], { allowError: true });
    if (!upstream) {
      const branch = runGit(repo.root, ["branch", "--show-current"], { allowError: true });
      if (branch) args = ["push", "-u", "origin", branch];
    }
  }
  try {
    const output = runGitMutation(repo.root, args);
    return { output, repository: refreshRepo(repo) };
  } catch (error) {
    const raw = String(error?.stderr || error?.stdout || error?.message || "").trim();
    if (action === "pull" && /fast-forward|divergent|diverged/i.test(raw)) {
      throw new Error("远端历史和本地分叉了,快进不了。到终端(或让 AI)跑 git pull --rebase 处理后再来。");
    }
    throw new Error(raw || "git command failed");
  }
};

const gitCheckout = ({ root, branch }) => {
  const repo = repoByRoot(root);
  const name = String(branch || "").trim();
  if (!name || /[\s~^:?*[\]\\]/.test(name)) throw new Error("invalid branch name");
  const output = runGitMutation(repo.root, ["checkout", name]);
  const repository = refreshRepo(repo);
  return { output, repository, branches: gitBranches(repository.root) };
};

export {
  gitBranches,
  gitLog,
  gitShow,
  gitCheckout,
  gitCommit,
  gitDiff,
  gitDiscard,
  gitRemoteAction,
  gitStage,
  gitUnstage,
  repositoryStatusForPath,
  listGitRepositories,
};

// git:仓库状态、diff、历史、分支,以及暂存 / 撤销 / 提交 / 远端 / 切换。
import type { IncomingMessage, ServerResponse } from "node:http";
import {
  gitBranches, gitCheckout, gitCommit, gitDiscard, gitDiff, gitLog,
  gitRemoteAction, gitShow, gitStage, gitUnstage, listGitRepositories, repositoryStatusForPath,
} from "../../git/repository.js";
import { json, parseBody } from "./helpers.js";

export const handleGitRoutes = async (req: IncomingMessage, res: ServerResponse, url: URL, method: string): Promise<boolean> => {
  const path = url.pathname;
  if (!path.startsWith("/api/git/")) return false;
  const q = (name: string) => url.searchParams.get(name);
  const root = () => q("root");

  if (method === "GET") {
    if (path === "/api/git/status") { json(res, 200, { ok: true, repositories: listGitRepositories() }); return true; }
    if (path === "/api/git/repository") { json(res, 200, { ok: true, repository: repositoryStatusForPath(q("path")) }); return true; }
    if (path === "/api/git/diff") {
      json(res, 200, { ok: true, ...gitDiff({ root: root(), filePath: q("path"), staged: q("staged") === "1", commit: q("commit") || "" }) }); return true;
    }
    if (path === "/api/git/log") { json(res, 200, { ok: true, ...gitLog({ root: root(), limit: Number(q("limit")) || 50 }) }); return true; }
    if (path === "/api/git/show") { json(res, 200, { ok: true, ...gitShow({ root: root(), hash: q("hash") }) }); return true; }
    if (path === "/api/git/branches") { json(res, 200, { ok: true, ...gitBranches(root()) }); return true; }
  }
  if (method === "POST") {
    const body = await parseBody(req);
    if (path === "/api/git/stage") { json(res, 200, { ok: true, repository: gitStage({ root: body.root, filePath: body.path, all: body.all }) }); return true; }
    if (path === "/api/git/unstage") { json(res, 200, { ok: true, repository: gitUnstage({ root: body.root, filePath: body.path, all: body.all }) }); return true; }
    if (path === "/api/git/discard") { json(res, 200, { ok: true, repository: gitDiscard({ root: body.root, filePath: body.path,  }) }); return true; }
    if (path === "/api/git/commit") { json(res, 200, { ok: true, ...gitCommit(body) }); return true; }
    if (path === "/api/git/remote") { json(res, 200, { ok: true, ...gitRemoteAction(body) }); return true; }
    if (path === "/api/git/checkout") { json(res, 200, { ok: true, ...gitCheckout(body) }); return true; }
  }
  return false;
};

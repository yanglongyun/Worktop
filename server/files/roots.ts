// 用户添加的常用目录入口；只维护入口记录，不删除磁盘目录。
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { getDb } from "../database/connection.js";

type RootFolder = {
  id: string;
  title: string;
  path: string;
  enabled: number;
  created_at: string;
  last_opened_at: string | null;
};

export const listRoots = (): RootFolder[] => {
  const rows = getDb().prepare("SELECT * FROM file_roots WHERE enabled = 1 ORDER BY created_at, id").all() as RootFolder[];
  return rows.map((row) => ({ ...row, path: path.resolve(row.path) })).filter((row) => {
    try { return fs.statSync(row.path).isDirectory(); } catch { return false; }
  });
};

export const addRoot = ({ path: rawPath, title }: { path?: string; title?: string } = {}) => {
  if (!String(rawPath || "").trim()) throw new Error("path is required");
  const abs = path.resolve(String(rawPath).trim());
  let stat: fs.Stats;
  try { stat = fs.statSync(abs); } catch { throw new Error(`目录不存在: ${abs}`); }
  if (!stat.isDirectory()) throw new Error(`不是文件夹: ${abs}`);
  const name = String(title || "").trim() || path.basename(abs) || abs;
  const id = createHash("sha1").update(abs).digest("hex").slice(0, 16);
  getDb().prepare(`
    INSERT INTO file_roots (id, title, path, enabled, last_opened_at)
    VALUES (?, ?, ?, 1, datetime('now'))
    ON CONFLICT(path) DO UPDATE SET title = excluded.title, enabled = 1, last_opened_at = datetime('now')
  `).run(id, name, abs);
  return abs;
};

export const setRootTitle = (abs: string, title: string) => {
  getDb().prepare("UPDATE file_roots SET title = ? WHERE path = ?")
    .run(String(title || "").trim() || path.basename(abs), abs);
};

export const removeRoot = (idOrPath: string): RootFolder | null => {
  const row = listRoots().find((root) => root.id === idOrPath || root.path === path.resolve(idOrPath));
  if (!row) return null;
  getDb().prepare("UPDATE file_roots SET enabled = 0 WHERE id = ?").run(row.id);
  return row;
};

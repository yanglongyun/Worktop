-- 应用内公告。按版本区间投放:1.0 的用户不该看到「1.3 已发布」。
CREATE TABLE IF NOT EXISTS notices (
  id          TEXT PRIMARY KEY,
  kind        TEXT NOT NULL DEFAULT 'info',   -- info / warn
  title       TEXT NOT NULL,
  body        TEXT NOT NULL DEFAULT '',
  link        TEXT NOT NULL DEFAULT '',
  -- 版本区间,留空 = 不限。语义化版本字符串比较由 Worker 做
  min_version TEXT NOT NULL DEFAULT '',
  max_version TEXT NOT NULL DEFAULT '',
  published   INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_notices_published ON notices(published, created_at DESC);

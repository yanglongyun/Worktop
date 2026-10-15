-- gateway.iimos.ai:key 与额度。额度单位是 token(input + output)。
CREATE TABLE IF NOT EXISTS keys (
  id            TEXT PRIMARY KEY,          -- 短 id,给人看的(wk_xxx 的前缀部分)
  token_hash    TEXT NOT NULL UNIQUE,      -- sha256(完整 key),库里不存明文
  owner         TEXT NOT NULL DEFAULT '',  -- 发给谁
  note          TEXT NOT NULL DEFAULT '',
  total_budget  INTEGER NOT NULL,          -- 总额度
  daily_budget  INTEGER NOT NULL,          -- 每日上限
  used_total    INTEGER NOT NULL DEFAULT 0,
  used_today    INTEGER NOT NULL DEFAULT 0,
  today         TEXT NOT NULL DEFAULT '',  -- used_today 对应的日期(UTC,YYYY-MM-DD)
  enabled       INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  last_used_at  TEXT
);

CREATE TABLE IF NOT EXISTS usage_log (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  key_id        TEXT NOT NULL,
  model         TEXT NOT NULL,
  input_tokens  INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  total_tokens  INTEGER NOT NULL DEFAULT 0,
  stream        INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS usage_log_key ON usage_log(key_id, created_at);

-- 全站每日总闸
CREATE TABLE IF NOT EXISTS daily (
  day           TEXT PRIMARY KEY,          -- UTC YYYY-MM-DD
  total_tokens  INTEGER NOT NULL DEFAULT 0
);

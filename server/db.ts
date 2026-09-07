import { randomUUID } from "crypto";
import fs from "fs";
import path from "path";
import { DatabaseSync } from "node:sqlite";
import { DATA_HOME } from "./home.js";

const DB_PATH = path.join(DATA_HOME, "database/worktop.db");

let db: DatabaseSync | undefined;

const initDb = () => {
  if (db) return db;
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  const fresh = !fs.existsSync(DB_PATH); // 只有新库才种规则,之后这张表归用户
  db = new DatabaseSync(DB_PATH);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");

  db.exec(`
    -- 文件树展示真实目录和文件;对话独立保存在数据库。
    -- SQLite 只存:消息流、设置、收藏。**运行状态不落库** ——
    --   跑到一半的轮次重启后本就恢复不了,而发生过什么已经逐条记在 messages 里。

    CREATE TABLE IF NOT EXISTS chats (
      id           TEXT PRIMARY KEY,
      -- 发起方:NULL = 用户自己开的会话;非 NULL = 该应用触发的任务(不进会话列表)
      origin_app   TEXT,
      title        TEXT NOT NULL,
      system       TEXT,
      pinned       INTEGER NOT NULL DEFAULT 0,
      last_read_at TEXT,
      created_at   TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- 消息:一行一个 Responses item(思考 / 正文 / 工具调用 / 结果),逐条落库
    CREATE TABLE IF NOT EXISTS messages (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_id    TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
      body       TEXT NOT NULL,
      meta       TEXT,
      usage      TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- 压缩:上下文超水位时的摘要,记住它替换了哪一段消息
    CREATE TABLE IF NOT EXISTS compactions (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_id          TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
      start_message_id INTEGER NOT NULL,
      end_message_id   INTEGER NOT NULL,
      summary          TEXT NOT NULL,
      tokens           INTEGER NOT NULL DEFAULT 0,
      created_at       TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- 应用触发的 agent 轮次(/host/ai/agent)。
    -- 过程与会话同规格:逐条落 messages(id 就是那段会话的 id);这里只记发起方与终局。
    CREATE TABLE IF NOT EXISTS tasks (
      id         TEXT PRIMARY KEY REFERENCES chats(id) ON DELETE CASCADE,
      app_id     TEXT NOT NULL,
      prompt     TEXT NOT NULL,
      status     TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running','done','error','aborted')),
      error      TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS workspaces (
      id             TEXT PRIMARY KEY,
      title          TEXT NOT NULL,
      path           TEXT NOT NULL UNIQUE,
      enabled        INTEGER NOT NULL DEFAULT 1,
      created_at     TEXT NOT NULL DEFAULT (datetime('now')),
      last_opened_at TEXT
    );

    -- 网站:活动栏「网站」面板的收藏(在网页标签里打开)
    -- 权限规则:一条规则 = 一个「命中就停下来问」的触发条件。
    -- 规则:用户写给助手的一句话,只进提示词。
    CREATE TABLE IF NOT EXISTS rules (
      id         TEXT PRIMARY KEY,
      text       TEXT NOT NULL,
      enabled    INTEGER NOT NULL DEFAULT 1,
      position   INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- 网站收藏:一棵浅树。kind='folder' 的行没有 url,别的行 parent_id 指向它。
    -- position 决定同级次序(拖拽排序),不靠 created_at —— 用户排的顺序和创建顺序无关。
    -- 密码:按网站存的账号密码。password_enc 是 AES-256-GCM 密文(密钥在钥匙串),库里没有明文。
    CREATE TABLE IF NOT EXISTS passwords (
      id           TEXT PRIMARY KEY,
      host         TEXT NOT NULL DEFAULT '',
      url          TEXT NOT NULL DEFAULT '',
      username     TEXT NOT NULL DEFAULT '',
      password_enc TEXT NOT NULL,
      note         TEXT NOT NULL DEFAULT '',
      created_at   TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_passwords_host ON passwords(host, username);

    CREATE TABLE IF NOT EXISTS sites (
      id         TEXT PRIMARY KEY,
      title      TEXT NOT NULL,
      url        TEXT NOT NULL,
      kind       TEXT NOT NULL DEFAULT 'site',   -- site | folder
      parent_id  TEXT,                            -- NULL = 根层
      position   INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- 浏览记录。一个 url 一行,重复访问只更新时间与次数 ——
    -- 逐次追加会让「最近」被同一个站刷屏,而用户想看的是「去过哪些地方」。
    CREATE TABLE IF NOT EXISTS history (
      url        TEXT PRIMARY KEY,
      title      TEXT NOT NULL DEFAULT '',
      visits     INTEGER NOT NULL DEFAULT 1,
      visited_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_history_time ON history(visited_at DESC);

    CREATE INDEX IF NOT EXISTS idx_messages_chat    ON messages(chat_id, id);
    CREATE INDEX IF NOT EXISTS idx_compactions_chat ON compactions(chat_id, id);
  `);

  if (fresh) seedRules(db);
  return db;
};

/**
 * 开箱自带的两条规则。**都没有硬闸** —— 它们要覆盖的正是闸看不见的地方:
 * browser 不在闸的作用域里,脚本内部干了什么闸也看不见,动作词汇表更是闭集。
 * 这两条走提示词,让助手自己调 confirm 停下来问。
 *
 * 只在建库那一刻种一次。种下去就是用户的,可改可删可排序,程序再也不碰。
 */
const seedRules = (db: DatabaseSync) => {
  const seeds = [
    "删除或移动我的文件之前,先问我。",
    "需要管理员权限、格式化磁盘,或启动常驻后台进程时,先问我。",
    "在我的电脑上安装软件或软件包之前,先问我。",
    "超出我交代范围的动作先问我:不可逆的、花钱的、对外发送的,以及在网页上提交或删除。",
    "发现我的前提有问题,先告诉我,不要自己换方案。",
  ];
  const write = db.prepare("INSERT INTO rules (id, text, enabled, position) VALUES (?, ?, 1, ?)");
  seeds.forEach((text, index) => write.run(randomUUID(), text, index));
};

const getDb = () => initDb();

export { getDb };

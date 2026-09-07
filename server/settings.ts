import { getDb } from "./db.js";

const DEFAULTS = {
  // 只认 OpenAI Responses API
  apiUrl: "",
  apiKey: "",
  model: "",
  compressThreshold: "64000",
  compactPrompt: "",
  toolResultMaxChars: "30000",
  // 匿名使用统计:on/off。只收 事件名/版本/平台/匿名安装 id(见 server/telemetry.ts)。
  telemetry: "on",
  // 规则开关:on = 规则写进提示词、confirm 工具在;off = 都不在。
  rulesEnabled: "on",
  // 关掉的技能(目录名 JSON 数组):不进提示词,文件不动。
  disabledSkills: "[]",
  // 默认人格(无自定义 system 的对话的兜底)。工具清单 / 身份 / 协作规则由 buildSystem 每次注入,
  // 这里只放一段简洁、务实的基调,避免和注入内容重复或过时。
  system:
    "务实、简洁,把事情真正做完 —— 需要建文件、跑命令、查资料,直接用工具去做,而不是只在嘴上说。" +
    "完成后给一个清楚的最终回复;工具的细节不必复述给用户。",
};

const getSettings = () => {
  const rows = getDb().prepare("SELECT key, value FROM settings").all() as { key: string; value: string }[];
  const settings = { ...DEFAULTS };
  for (const row of rows) {
    if (row.key in DEFAULTS) settings[row.key as keyof typeof DEFAULTS] = row.value;
  }
  return settings;
};

const saveSettings = (patch = {}) => {
  const db = getDb();
  const stmt = db.prepare(
    "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  );
  for (const [key, value] of Object.entries(patch)) {
    if (!(key in DEFAULTS)) continue;
    if (value === undefined || value === null) continue;
    stmt.run(key, String(value));
  }
  return getSettings();
};

export { getSettings, saveSettings };

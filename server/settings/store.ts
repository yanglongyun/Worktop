import { getDb } from "../database/connection.js";

import { DEFAULT_SETTINGS } from "./defaults.js";

const getSettings = () => {
  const rows = getDb().prepare("SELECT key, value FROM settings").all() as { key: string; value: string }[];
  const settings = { ...DEFAULT_SETTINGS };
  for (const row of rows) {
    if (row.key in DEFAULT_SETTINGS) settings[row.key as keyof typeof DEFAULT_SETTINGS] = row.value;
  }
  return settings;
};

const saveSettings = (patch = {}) => {
  const db = getDb();
  const stmt = db.prepare(
    "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  );
  for (const [key, value] of Object.entries(patch)) {
    if (!(key in DEFAULT_SETTINGS)) continue;
    if (value === undefined || value === null) continue;
    stmt.run(key, String(value));
  }
  return getSettings();
};

/** 工具循环上限:开关关掉就是不限(给循环一个永远到不了的整数);开着按 maxToolRounds,非法值回落默认 64。 */
export const toolRoundsOf = (settings: { toolRoundsLimit?: string; maxToolRounds?: string }) => {
  if ((settings.toolRoundsLimit || "on") === "off") return Number.MAX_SAFE_INTEGER;
  const n = Number(settings.maxToolRounds);
  return Number.isInteger(n) && n > 0 ? n : 64;
};

export { getSettings, saveSettings };

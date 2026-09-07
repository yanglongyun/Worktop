import { getDb } from "../database/connection.js";

import { DEFAULT_PROMPTS, DEFAULT_SETTINGS } from "./defaults.js";

const getSettings = () => {
  const rows = getDb().prepare("SELECT key, value FROM settings").all() as { key: string; value: string }[];
  const settings = { ...DEFAULT_SETTINGS };
  for (const row of rows) {
    if (row.key in DEFAULT_PROMPTS && !row.value.trim()) continue;
    if (row.key in DEFAULT_SETTINGS) settings[row.key as keyof typeof DEFAULT_SETTINGS] = row.value;
  }
  return settings;
};

const saveSettings = (patch = {}) => {
  const db = getDb();
  const stmt = db.prepare(
    "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  );
  const reset = db.prepare("DELETE FROM settings WHERE key = ?");
  for (const [key, value] of Object.entries(patch)) {
    if (!(key in DEFAULT_SETTINGS)) continue;
    if (value === undefined || value === null) continue;
    if (key in DEFAULT_PROMPTS && (!String(value).trim() || value === DEFAULT_PROMPTS[key as keyof typeof DEFAULT_PROMPTS])) {
      reset.run(key);
      continue;
    }
    stmt.run(key, String(value));
  }
  return getSettings();
};

export { getSettings, saveSettings };

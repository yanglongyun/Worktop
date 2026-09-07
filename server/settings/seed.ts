import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { DEFAULT_RULES } from "./defaults.js";

/** 只在全新数据库中写入默认规则。 */
export const seedSettings = (db: DatabaseSync) => {
  const write = db.prepare("INSERT INTO settings_rules (id, text, enabled, position) VALUES (?, ?, 1, ?)");
  DEFAULT_RULES.forEach((text, index) => write.run(randomUUID(), text, index));
};

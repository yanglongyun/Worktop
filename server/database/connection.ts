import fs from "fs";
import path from "path";
import { DatabaseSync } from "node:sqlite";
import { DATA_HOME } from "../system/paths.js";
import { SCHEMA } from "./schema.js";
import { seedSettings } from "../settings/seed.js";

const DB_PATH = path.join(DATA_HOME, "database/worktop.db");

let db: DatabaseSync | undefined;

const initDb = () => {
  if (db) return db;
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  const fresh = !fs.existsSync(DB_PATH); // 只有新库才种规则,之后这张表归用户
  db = new DatabaseSync(DB_PATH);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");

  db.exec(SCHEMA);

  if (fresh) seedSettings(db);
  return db;
};

const getDb = () => initDb();

export { getDb };

import { randomUUID } from "node:crypto";
import { getDb } from "../database/connection.js";
// 规则:用户写给助手的一句话。只有一个出口 —— 写进提示词。
//
// 没有硬闸。正则和词表只能看命令字面,覆盖面小却要养一套编译器;
// 与其给人「拦得住」的错觉,不如把赌注明白地押在模型遵守规则上。
// 规则要求先问的,模型调 confirm 等用户答复;规则关掉时 confirm 也不在,提示词里明说没有任何拦截。
type Rule = {
  id: string;
  text: string;
  enabled: boolean;
  position: number;
};

/** 拼进系统提示词的那段。rules 是启用的规则,顺序就是编号。on=false 表示规则整体关着。 */
export const rulesSection = (rules: Rule[], on: boolean) => {
  const lines: string[] = [];
  if (!on) {
    lines.push(
      "## 规则",
      "用户关掉了规则:没有任何拦截,也没有 confirm 工具。",
      "不要问「要不要继续」,用户选择了让你直接做。只做被交代的事;交代之外的不可逆操作留着不做,用一句话说明即可。",
    );
    return lines.join("\n");
  }
  const live = rules.filter((r) => r.enabled);
  lines.push("## 用户的规则", "用户对你提了这些要求,优先于你自己的判断:");
  live.forEach((rule, i) => lines.push(`- [${i + 1}] ${rule.text}`));
  if (!live.length) lines.push("(还没有规则)");
  lines.push(
    "",
    "凡是规则说要先问的,动手之前必须调用 confirm 工具,得到允许才做。",
    "规则没说到、但你自己觉得不可逆或拿不准的,也用 confirm 先问。",
    "普通的可逆步骤不要问,用户已经交代了的事直接做。",
  );
  return lines.join("\n");
};

// ---- 存取:规则就是一句话 + 开关 + 顺序 ----

type Row = { id: string; text: string; enabled: number; position: number };
const toRule = (row: Row): Rule => ({ id: row.id, text: row.text, enabled: !!row.enabled, position: row.position });

export const listRules = (): Rule[] =>
  (getDb().prepare("SELECT id, text, enabled, position FROM settings_rules ORDER BY position, created_at").all() as Row[]).map(toRule);

export const createRule = (text: string): Rule => {
  const db = getDb();
  const id = randomUUID();
  const position = (db.prepare("SELECT COALESCE(MAX(position), -1) + 1 AS p FROM settings_rules").get() as { p: number }).p;
  db.prepare("INSERT INTO settings_rules (id, text, enabled, position) VALUES (?, ?, 1, ?)").run(id, text, position);
  return { id, text, enabled: true, position };
};

export const updateRule = (id: string, patch: { text?: string; enabled?: boolean }): Rule | null => {
  const db = getDb();
  const row = db.prepare("SELECT id, text, enabled, position FROM settings_rules WHERE id = ?").get(String(id)) as Row | undefined;
  if (!row) return null;
  const next = { ...toRule(row), ...patch };
  db.prepare("UPDATE settings_rules SET text = ?, enabled = ? WHERE id = ?").run(next.text, next.enabled ? 1 : 0, next.id);
  return next;
};

export const deleteRule = (id: string) =>
  getDb().prepare("DELETE FROM settings_rules WHERE id = ?").run(String(id)).changes > 0;

/**
 * 重排:按给定的 id 顺序重写 position。
 * 没被提到的规则排在后面、相对次序不变 —— 界面发来的可能是一份稍旧的快照。
 */
export const reorderRules = (ids: unknown) => {
  const db = getDb();
  const current = listRules().map((r) => r.id);
  const wanted = (Array.isArray(ids) ? ids : []).map(String);
  const seen = new Set<string>();
  const ordered = wanted.filter((id) => current.includes(id) && !seen.has(id) && seen.add(id) !== undefined);
  const final = [...ordered, ...current.filter((id) => !seen.has(id))];
  const write = db.prepare("UPDATE settings_rules SET position = ? WHERE id = ?");
  final.forEach((id, index) => write.run(index, id));
  return listRules();
};

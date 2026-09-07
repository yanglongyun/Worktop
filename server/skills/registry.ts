// 出厂技能:随包播种到产品家目录 ~/.worktop/skills/<name>/SKILL.md,和出厂组件一个套路 ——
// 落地之后就是用户自己的文件,可改可删,已存在的目录绝不覆盖。
// 提示词里每条技能只占一行(名称 + 描述 + 路径),模型要用时自己 read。
// 开关:关掉的技能不进提示词(设置 disabledSkills 存名字列表),文件本身不动。
import fs from "fs";
import path from "path";
import { REPO_ROOT, productHome } from "../system/paths.js";
import { parseSkill } from "./parser.js";
import { getSettings, saveSettings } from "../settings/store.js";

const RESOURCES = process.env.WORKTOP_RESOURCES || path.join(REPO_ROOT, "resources");
const SKILL_NAME = /^[a-z0-9][a-z0-9-]{0,63}$/;

const skillsHome = () => path.join(productHome(), "skills");

export const seedPresetSkills = () => {
  const home = skillsHome();
  const presetDir = path.join(RESOURCES, "skills");
  let entries: fs.Dirent[];
  try { entries = fs.readdirSync(presetDir, { withFileTypes: true }); } catch { return; }
  fs.mkdirSync(home, { recursive: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const target = path.join(home, entry.name);
    if (fs.existsSync(target)) continue;
    try {
      fs.cpSync(path.join(presetDir, entry.name), target, { recursive: true });
      console.log(`[skills] 出厂技能已落地:skills/${entry.name}`);
    } catch (e: any) {
      console.error(`[skills] 落地失败 ${entry.name}:`, e?.message);
    }
  }
};

const disabledSet = () => {
  try { return new Set<string>(JSON.parse(getSettings().disabledSkills || "[]")); } catch { return new Set<string>(); }
};

type ProductSkill = { id: string; name: string; description: string; path: string; enabled: boolean };

/** 产品家目录里的技能(出厂的 + 用户自己放进去的),给所有对话用。id = 目录名。 */
export const listProductSkills = (): ProductSkill[] => {
  const home = skillsHome();
  let entries: fs.Dirent[];
  try { entries = fs.readdirSync(home, { withFileTypes: true }); } catch { return []; }
  const off = disabledSet();
  const out: ProductSkill[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !SKILL_NAME.test(entry.name)) continue;
    const file = path.join(home, entry.name, "SKILL.md");
    try {
      const meta = parseSkill(fs.readFileSync(file, "utf8"), entry.name);
      out.push({ id: entry.name, name: meta.name, description: meta.description, path: file, enabled: !off.has(entry.name) });
    } catch { /* 没有 SKILL.md 的目录不算技能 */ }
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
};

export const setSkillEnabled = (id: string, enabled: boolean) => {
  if (!SKILL_NAME.test(id)) throw new Error("技能名不合法");
  const off = disabledSet();
  if (enabled) off.delete(id); else off.add(id);
  saveSettings({ disabledSkills: JSON.stringify([...off].sort()) });
};

export const readSkillDoc = (id: string) => {
  if (!SKILL_NAME.test(id)) return null;
  try { return fs.readFileSync(path.join(skillsHome(), id, "SKILL.md"), "utf8"); } catch { return null; }
};

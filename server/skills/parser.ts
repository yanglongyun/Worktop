// SKILL.md → { name, description }:优先 frontmatter,回退到首个标题 / 首行
export const parseSkill = (content: string, fallbackName: string) => {
  let name = fallbackName, description = "";
  const fm = content.match(/^---\n([\s\S]*?)\n---/);
  if (fm) {
    const n = fm[1].match(/^name:\s*(.+)$/m); if (n) name = n[1].trim().replace(/^["']|["']$/g, "");
    const d = fm[1].match(/^description:\s*(.+)$/m); if (d) description = d[1].trim().replace(/^["']|["']$/g, "");
  }
  if (!description) {
    const body = content.replace(/^---\n[\s\S]*?\n---\n?/, "");
    const h = body.match(/^#\s+(.+)$/m); if (h && !name) name = h[1].trim();
    const firstPara = body.split(/\n\s*\n/).map((s) => s.replace(/^#+\s*/, "").trim()).find((s) => s.length > 0);
    description = (firstPara || "").slice(0, 200);
  }
  return { name, description };
};

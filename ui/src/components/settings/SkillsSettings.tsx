import { type SkillInfo, skillsApi } from "../../api/skills";
import { useEffect, useRef, useState } from "react";
import { ExternalLink } from "../ui/icons";
import { Switch } from "../ui";

export function SkillsSettings({ onOpenSkill }: { onOpenSkill: (skill: SkillInfo) => void }) {
  const [skills, setSkills] = useState<SkillInfo[] | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    setError("");
    void skillsApi.listSkills().then((list) => { if (active) setSkills(list); })
      .catch((e) => { if (active) setError(e instanceof Error ? e.message : "无法读取技能"); });
    return () => { active = false; };
  }, [attempt]);

  if (error) return <div role="alert" className="text-[13px]">
    <p className="text-danger">{error}</p>
    <button className="mt-3 border border-border px-3 py-1.5 hover:bg-bg-hover" onClick={() => setAttempt((n) => n + 1)}>重新加载</button>
  </div>;
  if (!skills) return <p className="text-[13px] text-text-faint">正在读取技能…</p>;
  if (!skills.length) return <div className="text-[13px] text-text-dim">
    <p>还没有技能</p>
    <p className="mt-2 text-[12px] text-text-faint">将技能放入 ~/.worktop/skills/&lt;名称&gt;/SKILL.md，即可在这里管理。</p>
  </div>;

  return <div>
    {skills.map((skill) => <SkillRow key={skill.id} skill={skill}
      onOpen={() => onOpenSkill(skill)}
      onChanged={(enabled) => setSkills((list) => list!.map((item) => item.id === skill.id ? { ...item, enabled } : item))} />)}
  </div>;
}

function SkillRow({ skill, onOpen, onChanged }: {
  skill: SkillInfo; onOpen: () => void; onChanged: (enabled: boolean) => void;
}) {
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const [error, setError] = useState("");
  const toggle = async (enabled: boolean) => {
    if (pending.current) return;
    pending.current = true; setBusy(true); setError("");
    try { await skillsApi.toggleSkill(skill.id, enabled); onChanged(enabled); }
    catch (e) { setError(e instanceof Error ? e.message : "更新失败，请重试。"); }
    finally { pending.current = false; setBusy(false); }
  };
  return <section className="border-b border-border py-4 first:pt-0 last:border-b-0">
    <div className="flex items-center gap-5">
      <div className="min-w-0 flex-1">
        <button type="button" title="在新标签页查看 SKILL.md" onClick={onOpen}
          aria-label={`在新标签页查看 ${skill.name} 的 SKILL.md`}
          className="inline-flex max-w-full items-center gap-1.5 text-left text-[13px] font-medium leading-5 text-accent underline decoration-accent/50 underline-offset-[3px] hover:decoration-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">
          <span className="min-w-0 break-words">{skill.name}</span><ExternalLink size={11} className="shrink-0" />
        </button>
        <p className="mt-1 text-[12px] leading-relaxed text-text-faint">{skill.description || "暂无描述"}</p>
      </div>
      <Switch on={skill.enabled} disabled={busy} onChange={(next) => void toggle(next)} label={`${skill.enabled ? "停用" : "启用"} ${skill.name}`} />
    </div>
    {error && <p role="alert" className="pb-3 text-[12px] text-danger">{error}</p>}
  </section>;
}

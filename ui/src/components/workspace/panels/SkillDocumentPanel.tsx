import { useEffect, useState } from "react";
import { api, type SkillInfo } from "../../../api";
import { renderMarkdown } from "../../../lib/markdown";

export function SkillDocumentPanel({ skill }: { skill: SkillInfo }) {
  const [content, setContent] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    setError("");
    void api.skillDoc(skill.id).then((result) => { if (active) setContent(result.content); })
      .catch((e) => { if (active) setError(e instanceof Error ? e.message : "无法读取 SKILL.md"); });
    return () => { active = false; };
  }, [skill.id, attempt]);
  return <div className="min-h-0 flex-1 overflow-auto bg-bg px-6 py-8 md:px-12">
    <div className="mx-auto max-w-3xl">
      {error ? <div role="alert" className="text-[13px] text-danger">{error}
        <button className="ml-3 text-accent hover:underline" onClick={() => setAttempt((n) => n + 1)}>重试</button></div>
        : content === null ? <p className="text-[13px] text-text-faint">正在读取 SKILL.md…</p>
        : <div className="prose" dangerouslySetInnerHTML={{ __html: renderMarkdown(content.replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, "")) }} />}
      <p className="mt-8 break-all font-mono text-[11px] text-text-faint">{skill.path}</p>
    </div>
  </div>;
}

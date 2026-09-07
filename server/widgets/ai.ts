// 组件的 ai 能力:无状态单次补全 —— 不建对话、不进邮箱、没有历史。
// 每次调用把 summary 打到服务端控制台(问责的形式保留,但不落库);summary 必填。
// 用用户在设置里配好的同一套模型;每组件并发限 2,可见性是第一道闸。
import { complete } from "../ai/complete.js";
import { getSettings } from "../settings/store.js";

const inflight = new Map<string, number>();
const MAX_CONCURRENT = 2;
const ERROR_MAX_CHARS = 4000;

export const runWidgetAi = async ({
  widgetId,
  summary,
  system = "",
  prompt,
}: {
  widgetId: string;
  summary: string;
  system?: string;
  prompt: string;
}) => {
  if (!String(summary || "").trim()) throw new Error("summary 必填:一句话说明这次调用的目的");
  if (!String(prompt || "").trim()) throw new Error("prompt 不能为空");

  const settings = getSettings();
  if (!settings.apiUrl || !settings.apiKey || !settings.model) {
    throw new Error("还没配置模型(设置 → 接口协议 / API URL / API Key / 模型)");
  }
  const current = inflight.get(widgetId) || 0;
  if (current >= MAX_CONCURRENT) throw new Error("该应用的 AI 调用过于频繁,请稍后再试");
  inflight.set(widgetId, current + 1);
  console.log(`[widget:${widgetId}] ai — ${String(summary).slice(0, 120)}`);
  try {
    const result = await complete({
      modelOptions: undefined,
      retry: undefined,
      signal: undefined,
      responsesUrl: settings.apiUrl,
      apiKey: settings.apiKey,
      model: settings.model,
      errorMaxChars: ERROR_MAX_CHARS,
      instructions: String(system || ""),
      input: [{ role: "user", content: String(prompt).slice(0, 100_000) }],
    });
    const tokens = Number((result.usage as any)?.total_tokens) || 0;
    console.log(`[widget:${widgetId}] ai 完成 — ${tokens} tokens`);
    return { text: String(result.text || ""), tokens };
  } catch (e: any) {
    console.error(`[widget:${widgetId}] ai 出错 —`, e?.message || e);
    throw e;
  } finally {
    inflight.set(widgetId, (inflight.get(widgetId) || 1) - 1);
  }
};

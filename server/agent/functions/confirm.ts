// 提醒工具。
//
// 规则是**用户**定的条件,系统照着拦;提醒是**助手**自己的判断 —— 它觉得这一步敏感、
// 可能不可逆、或者拿不准用户愿不愿意,就主动停下来问一句。规则没说到的地方也管用。
//
// 两条边界必须守住:
//   1. 它只能**增加**摩擦,不能减少。没有任何路径能让助手靠调用它来跳过规则 ——
//      它走的是同一条问询通道,加在规则之外,不替换规则。
//   2. 它是助手的判断,**不是保证**。界面不许让人以为「危险操作它一定会问」。
import { requestConfirm } from "../../chats/approvals.js";

export const confirmDef = {
  type: "function",
  name: "confirm",
  description: [
    "在动手之前先提醒用户并等确认。用在你自己觉得该问一句的时候:",
    "操作不可逆、影响面比你被交代的更大、要动你没被明确授权的东西、",
    "或者你注意到用户的处境可能和你的默认假设不一样。",
    "得到允许之前不要执行。用户不同意就换做法或如实说明,不要绕过。",
  ].join(""),
  parameters: {
    type: "object",
    properties: {
      summary: { type: "string", description: "一句话说明你打算做什么" },
      detail: { type: "string", description: "具体到命令、路径和影响范围,让用户能判断" },
      risk: { type: "string", description: "你觉得风险或不确定在哪里" },
    },
    required: ["summary", "detail", "risk"],
    additionalProperties: false,
  },
};

export const confirm = async (args: any = {}, ctx: any = {}) => {
  const answer = await requestConfirm({
    chatId: String(ctx.chatId || ""),
    summary: String(args?.summary || "").slice(0, 300),
    detail: String(args?.detail || "").slice(0, 4000),
    risk: String(args?.risk || "").slice(0, 1000),
    signal: ctx.signal,
  });
  if (answer === "allow") return { approved: true, reason: "用户同意了,可以继续。" };
  return {
    approved: false,
    reason: answer === "timeout"
      ? "提醒超时,没有得到答复。不要执行,如实告诉用户。"
      : "用户不同意。不要执行这件事,换个做法或如实说明,不要绕过。",
  };
};

// 待确认的提醒(confirm 工具)。一次调用停在这儿,直到用户表态、超时,或整轮被停。
//
// 三条出口都必须有人兜底 —— 悬着的 Promise 会把整轮 agent 永远挂住,
// 而挂住的那一轮既不入库也不报错,是最难查的一类故障。
import { randomUUID } from "node:crypto";
import { emit } from "../bus.js";

const TIMEOUT_MS = 300_000;

type ApprovalCard = {
  id: string;
  chatId: string;
  /** 助手打算做什么(一句话) */
  summary: string;
  /** 具体到命令、路径、影响范围 */
  detail: string;
  /** 助手说的风险在哪 */
  risk: string;
  at: string;
};

type Answer = "allow" | "deny" | "timeout";

type Entry = { resolve: (answer: Answer) => void; timer: NodeJS.Timeout; card: ApprovalCard; cleanup: () => void };
const pending = new Map<string, Entry>();

const settle = (id: string, answer: Answer) => {
  const entry = pending.get(id);
  if (!entry) return false;
  pending.delete(id);
  clearTimeout(entry.timer);
  entry.cleanup();
  emit({ type: "approval_done", id, chatId: entry.card.chatId, answer });
  entry.resolve(answer);
  return true;
};

/** 刷新页面要能把还悬着的卡捞回来,否则用户永远等不到那张卡。 */
export const listApprovals = (chatId: string) =>
  [...pending.values()].filter((e) => e.card.chatId === chatId).map((e) => e.card);

export const respondApproval = (id: string, answer: string) =>
  settle(String(id), answer === "allow" ? "allow" : "deny");

export const requestConfirm = (
  { chatId, summary, detail, risk, signal }:
  { chatId: string; summary: string; detail: string; risk: string; signal?: AbortSignal },
): Promise<Answer> => {
  const id = randomUUID();
  const card: ApprovalCard = { id, chatId, summary, detail, risk, at: new Date().toISOString() };
  return new Promise((resolve) => {
    const timer = setTimeout(() => settle(id, "timeout"), TIMEOUT_MS);
    const onAbort = () => settle(id, "deny");
    signal?.addEventListener("abort", onAbort, { once: true });
    pending.set(id, { resolve, timer, card, cleanup: () => signal?.removeEventListener("abort", onAbort) });
    emit({ type: "approval_ask", ...card });
  });
};

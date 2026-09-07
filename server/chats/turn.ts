// @ts-nocheck
// 运行编排:一个对话同一时刻只有一轮在跑。
//   - 组装历史与 system → 调 agent/ 循环 → **逐条落库** → 事件广播
//   - 压缩在循环里每次请求前判断(依据是最近一次应答的 usage,每次应答都落库);
//     压了循环 emit compact,这里记 compactions 锚点、把摘要落成一条消息
//   - 运行状态只在内存里(running Map)+ 事件广播;跑到一半重启本就恢复不了
//   - 停止/出错收尾:悬空 function_call 补输出(Responses 要求成对,缺了下一轮请求被拒),
//     落 [stopped]/[error] 留痕 —— 给用户看,也给模型看
//
// agent/ 循环完全不知道树/邮箱/进程/调用,所有状态在这里管。
import { complete } from "../ai/complete.js";
import { runAgent as runAi } from "../agent/index.js";
import { EVENTS } from "../shared/events.js";
import { createRunner, tools } from "../agent/tools.js";
import { executionDirectory, outputDirectory } from "../agent/paths.js";
import { buildSystem } from "./prompt.js";
import { DEFAULT_TITLE, getChat, updateChat } from "./store.js";
import { appendItem, latestUsage, listRows } from "./messages.js";
import { createCompaction, getLatestCompaction } from "./compactions.js";
import { getSettings, toolRoundsOf } from "../settings/store.js";
import { prepareInput } from "./input.js";
import { emit } from "../bus.js";

const ERROR_MAX_CHARS = 4000;

/** 压缩配置:水位就是 settings.compressThreshold(token),0 = 不压。 */
export const compactionOf = (settings) => {
  const threshold = Number(settings.compressThreshold || 0) || 0;
  if (!threshold) return null;
  return {
    contextWindowTokens: threshold,
    foldRatio: 1,
    tailKeepChars: 40_000,
    summaryMinChars: 80,
    callArgsMaxChars: 2_000,
    callOutputMaxChars: 4_000,
    mechanicalItemMaxChars: 160,
    prompt: settings.compactPrompt,
  };
};

// ── 对话级运行注册:stop 对任意 chatId 都生效 ──
const running = new Map();
const runningIds = () => [...running.keys()];
const stopChat = (chatId) => { running.get(String(chatId))?.abort(); };

const parseArgs = (value) => {
  try { return JSON.parse(String(value || "{}")); } catch { return {}; }
};

const messageText = (item) => {
  if (typeof item?.content === "string") return item.content;
  if (Array.isArray(item?.content)) return item.content.map((part) => part?.text || "").join("");
  return "";
};

/**
 * 账本:循环吐出来的每个 item 逐条落库;压缩事件在这里换成 compactions 锚点 + 一条摘要消息。
 * live 是「库里这段上下文对应的行」,压缩要靠它把尾段条数换算成消息 id 区间。
 * 会话轮次和应用任务共用 —— 落库口径只写一处。
 */
export const createLedger = (chatId, rows) => {
  const live = rows.map((row) => ({ id: row.id, item: row.item, summary: row.meta?.kind === "compaction" }));
  const generated = [];
  const record = (type, data) => {
    if (type === "compact") {
      if (data.phase === "started") { emit({ type: EVENTS.COMPACT_START, chatId }); return; }
      // 锚点只按原文的 id 算:上一份摘要行的 id 比它替代的历史都大,拿它当锚点会把尾段一起划到锚点之前
      const cut = live.length - data.tailCount;
      const originals = live.slice(0, cut).filter((row) => !row.summary);
      if (data.compacted && originals.length) {
        const tail = live.slice(cut);
        const startMessageId = originals[0].id;
        const endMessageId = originals[originals.length - 1].id;
        const compactionId = createCompaction({ chatId, startMessageId, endMessageId, summary: data.summary, tokens: data.tokens });
        // 摘要落成一条消息:详情页能看到,下一轮从锚点之后取历史时它自然在其中(只认最新一份,见 runChat)
        const row = appendItem(chatId, data.history[0], { meta: { kind: "compaction", compactionId, startMessageId, endMessageId } });
        emit({ type: EVENTS.INPUT, chatId, row });
        live.splice(0, live.length, { id: row.id, item: data.history[0], summary: true }, ...tail);
      }
      emit({ type: EVENTS.COMPACT_DONE, chatId });
      return;
    }
    if (!data.item) return;
    const row = appendItem(chatId, data.item, { usage: data.usage || null });
    live.push({ id: row.id, item: data.item, summary: false });
    generated.push(data.item);
    if (type === "function_call") {
      emit({ type: EVENTS.TOOL_CALLS, chatId, calls: [{ callId: data.item.call_id, name: data.item.name, args: parseArgs(data.item.arguments) }] });
    } else if (type === "function_call_output") {
      emit({ type: EVENTS.TOOL_OUTPUT, chatId, callId: data.item.call_id, result: data.item.output || "" });
    }
  };
  return { live, generated, record };
};

/**
 * 首条消息跑完后给对话取名 —— 独立的一次补全调用,和对话运行完全分离,
 * 失败退回机械截断(用户消息前 24 字),保证一定脱离「未命名对话」。
 */
const autoTitle = async (chatId, rows, finalText, settings) => {
  const lastUser = [...rows].reverse().find((r) => r.item?.role === "user" && r.meta?.kind === "message")
    || [...rows].reverse().find((r) => r.item?.role === "user");
  const ask = String(lastUser?.item?.content || "").replace(/\s+/g, " ").trim();
  let title = "";
  try {
    const result = await complete({
      responsesUrl: settings.apiUrl,
      apiKey: settings.apiKey,
      model: settings.model,
      errorMaxChars: ERROR_MAX_CHARS,
      instructions: "为这段对话起一个简短标题(中文不超过 16 字,英文不超过 6 个词),用对话本身的语言,概括用户想做的事。只输出标题本身,不要引号和句号。",
      input: [{ role: "user", content: `用户:${ask.slice(0, 1200)}\n\n助手:${String(finalText || "").slice(0, 1200)}` }],
    });
    title = String(result.text).replace(/\s+/g, " ").trim().slice(0, 32);
  } catch { /* 模型起不出来就机械截断 */ }
  if (!title) title = ask.slice(0, 24);
  if (!title) title = String(lastUser?.item?.attachments?.[0]?.name || "").slice(0, 24); // 只发了附件没打字
  if (!title) return;
  updateChat(chatId, { title });
  emit({ type: "chats_changed" });
};

/** 停止/出错后,给没等到结果的 function_call 补一条输出,落库并广播。 */
const settleDanglingCalls = (chatId, items, reason) => {
  const pending = new Map();
  for (const item of items) {
    if (item?.type === "function_call") pending.set(item.call_id, item);
    else if (item?.type === "function_call_output") pending.delete(item.call_id);
  }
  for (const call of pending.values()) {
    const output = { type: "function_call_output", call_id: call.call_id, output: `error: ${reason}` };
    appendItem(chatId, output);
    emit({ type: EVENTS.TOOL_OUTPUT, chatId, callId: call.call_id, result: output.output });
  }
};

const runChat = async (chatId) => {
  const chat = getChat(chatId);
  if (!chat) throw new Error(`chat not found: ${chatId}`);
  if (running.has(String(chatId))) throw new Error("already running");
  const wasUntitled = chat.title === DEFAULT_TITLE;

  const settings = getSettings();
  if (!settings.apiUrl || !settings.apiKey || !settings.model) {
    throw new Error("还没配置模型(设置 → API URL / API Key / 模型)");
  }

  const controller = new AbortController();
  running.set(String(chatId), controller);
  const signal = controller.signal;

  emit({ type: EVENTS.RUN_START, chatId });

  // 历史从最近一次压缩的锚点之后取;摘要行在锚点之后,自然在其中
  const latest = getLatestCompaction(chatId);
  // 摘要行落库时 id 排在尾段之后,但发给模型时它必须在最前面;锚点只按原文 id 算,旧摘要也会落在锚点之后,
  // 只认最新一份 —— 每次压缩都把上一份摘要折进新摘要,旧的已被替代
  const after = listRows(chatId, { afterId: Number(latest?.end_message_id || 0) });
  const summaries = after.filter((row) => row.meta?.kind === "compaction");
  const rows = [...summaries.slice(-1), ...after.filter((row) => row.meta?.kind !== "compaction")];
  const ledger = createLedger(chatId, rows);

  try {
    const cwd = executionDirectory();
    const ctx = {
      selfChatId: chatId,
      chatId,        // confirm 要用它把提醒卡投到这段对话里
      signal,        // 整轮被停时,悬着的提醒卡跟着收掉
      cwd,
      outputDir: outputDirectory(chatId),
      emit,
      toolResultMaxChars: Number(settings.toolResultMaxChars) || 30000,
    };

    const emitKernel = (type, data) => {
      if (type === "message" && data.delta) { emit({ type: EVENTS.MESSAGE_DELTA, chatId, content: data.delta }); return; }
      if (type === "reasoning" && data.delta) { emit({ type: EVENTS.REASONING_DELTA, chatId, content: data.delta }); return; }
      if (type === "function_call" && data.phase === "started") { emit({ type: EVENTS.TOOL_CALL_START, chatId }); return; }
      if (type === "retry") {
        // 网络抖动/限流,循环在退避重试 —— 透给界面,别让用户以为卡死了
        emit({ type: EVENTS.RUN_RETRY, chatId, attempt: data.attempt, maxRetries: data.maxRetries, delayMs: data.delayMs, message: String(data.error || "") });
        return;
      }
      ledger.record(type, data); // item 落库 / 压缩记账;循环自己的 done/error 不落,终局由本层广播
    };

    // 规则开关:开着 confirm 工具在;关着连它也不在(描述一个调不到的工具,模型只会去调然后撞空)
    const rulesOn = (settings.rulesEnabled || "on") !== "off";

    const result = await runAi({
      runId: crypto.randomUUID(),
      responsesUrl: settings.apiUrl,
      apiKey: settings.apiKey,
      model: settings.model,
      instructions: buildSystem(chat, settings),
      input: rows.map((row) => row.item),
      tools: rulesOn ? tools : tools.filter((t) => t.name !== "confirm"),
      run: createRunner(ctx),
      maxRounds: toolRoundsOf(settings),
      errorMaxChars: ERROR_MAX_CHARS,
      compaction: compactionOf(settings),
      usage: latestUsage(chatId),
      signal,
      emit: emitKernel,
      prepareInput, // 附件展开/剥除:当前轮的图片才进 input_image,旧轮不带字节
    });

    const finalText = ledger.generated
      .filter((item) => item?.type === "message")
      .map(messageText)
      .join("\n\n")
      .trim();

    // 截断/内容过滤(response.incomplete):落 [incomplete] 留痕 —— 给用户看,也给模型看
    if (result.stopReason) {
      const marker = { role: "system", content: `[incomplete] 上一条回复未完整结束:${result.stopReason}` };
      const row = appendItem(chatId, marker, { meta: { kind: "marker" } });
      emit({ type: EVENTS.INPUT, chatId, row });
    }
    emit({ type: EVENTS.RUN_DONE, chatId, usage: result.usage || null });
    if (wasUntitled) void autoTitle(chatId, rows, finalText, settings); // 取名独立走,不挡终局
    return finalText;
  } catch (error) {
    const aborted = signal.aborted || error?.name === "AbortError";
    const message = String(error?.message || error).slice(0, ERROR_MAX_CHARS);
    settleDanglingCalls(chatId, ledger.generated, aborted ? "任务被用户停止,该调用未完成" : "运行出错,该调用未完成");

    const marker = aborted
      ? { role: "system", content: "[stopped] 上一条回复被用户停止,输出到此为止。" }
      : { role: "system", content: `[error] 上一轮运行失败:${message}` };
    const row = appendItem(chatId, marker, { meta: { kind: "marker" } });
    emit({ type: EVENTS.INPUT, chatId, row });
    if (aborted) emit({ type: EVENTS.RUN_ABORTED, chatId });
    else emit({ type: EVENTS.RUN_ERROR, chatId, message });
    throw error;
  } finally {
    running.delete(String(chatId));
  }
};

export { runChat, stopChat, runningIds };

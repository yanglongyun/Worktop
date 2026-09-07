// @ts-nocheck
// 应用触发的活儿 —— 任务机制。两种入口:
//   /host/ai/agent    完整 agent 轮次(带工具),SSE 流回
//   /host/ai/complete 单次补全(无工具),一问一答
// 两者都在「任务」里留一条记录,用户看得见应用替自己干了什么。
//
// 过程与用户会话**同规格**:每一步(思考/正文/工具调用/工具结果)逐条落 messages,
// 任务本身就是一段会话 —— tasks.id 即 chats.id,只是 chats.origin_app 记着是哪个应用开的,
// 因此它不进会话列表,在「任务」里看。这样详情页能完整回放它到底干了什么。
//
// 与用户会话的两点不同:
//   1. **不过规则**:任务没有人守在旁边,confirm 也不在工具表里 —— 直接按 skip 跑;
//   2. 结果以 SSE 流回给发起的应用:tool(进度)/ error / done。应用只认 error 和 done。
import { runAgent as runAi } from "../agent/index.js";
import { createRunner, tools } from "../agent/tools.js";
import { getSettings } from "../settings.js";
import { createTask, settleTask } from "./taskStore.js";
import { createChat } from "../chat/chats.js";
import { appendItem } from "../chat/messages.js";
import { EVENTS } from "../shared/events.js";
import { executionDirectory, outputDirectory } from "../agent/paths.js";
import { buildSystem } from "../chat/system.js";
import { compactionOf, createLedger } from "../chat/turn.js";
import { emit } from "../bus.js";

const MAX_ROUNDS = 64;
const ERROR_MAX_CHARS = 4000;

/**
 * 开一条任务:建会话行(origin_app 标记发起方,据此不进会话列表)+ tasks 行 + 第一条用户消息。
 * agent 与 complete 共用 —— 从用户视角这两件事没有区别,都是「应用替我干活」。
 */
export const openTask = ({ appId, title, prompt }) => {
  const chat = createChat({ title: String(title || prompt).slice(0, 24), originApp: appId });
  createTask({ id: chat.id, appId, prompt });
  const userRow = appendItem(chat.id, { role: "user", content: prompt.slice(0, 100_000) }, { meta: { kind: "message" } });
  emit({ type: "tasks_changed" });
  return { taskId: chat.id, userRow };
};

/** 落一条助手消息并广播 —— complete 那条一问一答的「答」。 */
export const recordTaskReply = (taskId, text, usage = null) => {
  appendItem(taskId, { type: "message", role: "assistant", content: [{ type: "output_text", text: String(text) }] }, { usage });
  emit({ type: EVENTS.INPUT, chatId: taskId });
};

export const runAppTask = async (
  { appId, appName, title, prompt, cwd: requestedCwd },
  res, // ServerResponse:SSE 从这里流出去
) => {
  const settings = getSettings();
  if (!settings.apiUrl || !settings.apiKey || !settings.model) {
    res.writeHead(400, { "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ error: "宿主还没配置模型:先在设置里填接口地址、密钥和模型" }));
    return;
  }

  const cwd = executionDirectory(requestedCwd);
  const { taskId, userRow } = openTask({ appId, title, prompt });

  res.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-store",
    connection: "keep-alive",
  });
  const send = (event, data) => {
    try { res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); } catch { /* 对端已断 */ }
  };
  send("start", { taskId });

  const controller = new AbortController();
  res.on("close", () => controller.abort()); // 应用断开(它自己有超时)= 停止任务

  const ctx = {
    selfChatId: taskId,
    chatId: taskId,
    signal: controller.signal,
    cwd,
    outputDir: outputDirectory(taskId),
    emit,
    toolResultMaxChars: Number(settings.toolResultMaxChars) || 30000,
  };
  // 任务的历史就是刚落的那条用户消息;和会话同一套账本,压缩同样在循环里
  const ledger = createLedger(taskId, [{ id: userRow.id, item: userRow.item }]);

  try {
    await runAi({
      runId: taskId,
      responsesUrl: settings.apiUrl,
      apiKey: settings.apiKey,
      model: settings.model,
      instructions: buildSystem({ id: taskId, system: null }, settings, { rules: false, cwd })
        + `\n\n# 本轮是应用触发的任务\n\n发起方:应用「${appName}」(${appId})。没有用户守在旁边,不要提问、不要等确认;`
        + `按提示把事做完,做不了就直说失败原因。`,
      input: [userRow.item],
      tools: tools.filter((t) => t.name !== "confirm"), // 没人守着,不能问
      run: createRunner(ctx),
      maxRounds: MAX_ROUNDS,
      errorMaxChars: ERROR_MAX_CHARS,
      compaction: compactionOf(settings),
      signal: controller.signal,
      // 与会话同一套落库口径:循环吐出的每个 item 都进 messages,详情页据此回放
      emit: (type, data) => {
        if (type === "function_call" && data.phase === "started") { send("tool", { phase: "started" }); return; }
        if (type !== "compact" && !data.item) return;
        ledger.record(type, data);
        if (data.item) emit({ type: EVENTS.INPUT, chatId: taskId });
        if (type === "function_call") send("tool", { name: data.item.name });
      },
    });

    const finalText = ledger.generated
      .filter((item) => item?.type === "message")
      .map((item) => (typeof item.content === "string" ? item.content
        : Array.isArray(item.content) ? item.content.map((p) => p?.text || "").join("") : ""))
      .join("\n\n").trim();

    settleTask(taskId, "done");
    send("done", { taskId, text: finalText });
  } catch (error) {
    const aborted = controller.signal.aborted || error?.name === "AbortError";
    const message = String(error?.message || error).slice(0, ERROR_MAX_CHARS);
    settleTask(taskId, aborted ? "aborted" : "error", message);
    if (!aborted) send("error", { taskId, message });
    send("done", { taskId }); // 契约:done 是终局信号,error 之后也要发
  } finally {
    emit({ type: "tasks_changed" });
    try { res.end(); } catch { /* 已断 */ }
  }
};

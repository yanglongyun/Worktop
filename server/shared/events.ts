// 对话事件契约：服务端与界面共用。所有事件携带 chatId。
export const EVENTS = Object.freeze({
  /** 已落库的上下文输入记录：用户消息、压缩摘要、系统留痕等。{ row } */
  INPUT: "conversation.input",

  /** 思考与正文的流式增量。{ content } */
  REASONING_DELTA: "conversation.reasoning.delta",
  MESSAGE_DELTA: "conversation.message.delta",

  /** 模型开始生成工具调用参数，尚未执行工具。 */
  TOOL_CALL_START: "conversation.tool.call.start",
  /** 工具调用参数已就绪。{ calls: [{ callId, name, args }] } */
  TOOL_CALLS: "conversation.tool.calls",
  /** 单次工具调用返回结果。{ callId, result } */
  TOOL_OUTPUT: "conversation.tool.output",

  /** 压缩状态；摘要记录通过 INPUT 发送。 */
  COMPACT_START: "conversation.compact.start",
  COMPACT_DONE: "conversation.compact.done",

  /** 一轮运行开始。 */
  RUN_START: "conversation.run.start",
  /** 模型请求退避重试。{ attempt, maxRetries, delayMs, message } */
  RUN_RETRY: "conversation.run.retry",
  /** 本轮停止、完成或失败；系统留痕通过 INPUT 发送。 */
  RUN_ABORTED: "conversation.run.aborted",
  RUN_DONE: "conversation.run.done", // { usage }
  RUN_ERROR: "conversation.run.error", // { message }
});

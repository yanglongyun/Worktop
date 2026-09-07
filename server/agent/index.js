// 模型 → 工具 → 模型,直到模型不再调用工具。与 AGENT 仓库 agent/index.js 同源。
//
// 这里不认识 Worktop:给模型看的工具定义和执行一次调用的 run(call) 都由调用方给;
// 上下文压缩在循环里做 —— 工具循环是上下文增长的大头,只在一轮开头看一眼不够 ——
// 压缩配置由调用方注入,压了就 emit 一个 compact 事件,记账是调用方的事。
import { request } from '../ai/request.js';
import { compact } from './compact.js';

export async function runAgent({
    runId,
    responsesUrl,
    apiKey,
    model,
    instructions = '',
    input,
    /** 给模型看的工具定义。 */
    tools = [],
    /** 执行一次 function_call,返回 function_call_output item。 */
    run,
    modelOptions,
    retry,
    maxRounds,
    errorMaxChars,
    /** 压缩配置(水位、尾段保留量、摘要提示词)。不给就不压。 */
    compaction = null,
    /** 最近一次已知的用量,给第一次请求前的压缩判断用;之后每次请求回来都会更新。 */
    usage = null,
    signal,
    emit = () => {},
    /** 上线形态:把上下文整理成请求体(比如把图片换成 data URL)。只影响发出去的那份,不改上下文本身。 */
    prepareInput = async (items) => items,
}) {
    if (!runId || !Array.isArray(input)) throw new Error('runId 和 input 必填');
    if (typeof run !== 'function') throw new Error('run 必填');
    if (!Number.isInteger(maxRounds) || maxRounds <= 0) throw new Error('maxRounds 必须是正整数');

    // context 是当前上下文:传进来的历史 + 这一轮新产生的,压缩会整体替换它
    let context = [...input];
    try {
        for (let round = 0; round < maxRounds; round += 1) {
            if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

            // 每次请求前都看一眼水位 —— 拿的是最近一次应答的 usage
            if (compaction) {
                const folded = await compact({ history: context, usage, compaction, responsesUrl, apiKey, model, errorMaxChars, signal,
                    onStart: () => emit('compact', { phase: 'started' }),
                });
                if (folded.compacted) {
                    context = folded.history;
                    // 原文由宿主自己留着;只有实际完成压缩才通知宿主记账和更新界面。
                    emit('compact', { phase: 'done', compacted: true, summary: folded.summary, kind: folded.kind, tokens: folded.tokens, tailCount: folded.tailCount, history: context });
                }
            }

            const result = await request({
                url: responsesUrl,
                apiKey,
                model,
                input: await prepareInput(context),
                instructions: String(instructions),
                tools,
                modelOptions,
                retry,
                signal,
                onEvent: emit,
                errorMaxChars,
            });

            usage = result.usage;
            const calls = result.items.filter((item) => item.type === 'function_call');
            result.items.forEach((item, index) => {
                context.push(item);
                // usage 挂在这次应答的最后一个 item 上:上层收到它就存,水位每次应答都更新
                const attach = index === result.items.length - 1 ? usage : undefined;
                if (item.type === 'message') emit('message', { item, usage: attach });
                else if (item.type === 'reasoning') emit('reasoning', { item, usage: attach });
                else if (item.type === 'function_call') emit('function_call', { phase: 'completed', item, usage: attach });
            });

            if (!calls.length) {
                // 截断 / 内容过滤走 incomplete。原样透出,别让上层把半截回复当完整结果。
                const done = { runId, status: result.status || 'completed', usage };
                if (result.stopReason) done.stopReason = result.stopReason;
                emit('done', done);
                return { context, usage, status: done.status, stopReason: result.stopReason || '' };
            }

            for (const call of calls) {
                if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
                const item = await run(call);
                context.push(item);
                emit('function_call_output', { item });
            }
        }
        throw new Error(`达到工具循环上限(${maxRounds})`);
    } catch (error) {
        if (signal?.aborted) emit('done', { runId, status: 'aborted' });
        else emit('error', { runId, terminal: true, error: String(error?.message || error) });
        throw error;
    }
}

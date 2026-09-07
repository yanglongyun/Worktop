// 按上下文水位压缩早期历史。每次请求前都可能被调用 —— 工具循环内也一样。
import { complete } from '../ai/complete.js';

const chars = (item) => {
    try { return JSON.stringify(item).length; } catch { return 0; }
};

const text = (item, config) => {
    if (item?.type === 'function_call') return `${item.name}: ${String(item.arguments || '').slice(0, config.callArgsMaxChars)}`;
    if (item?.type === 'function_call_output') return String(item.output || '').slice(0, config.callOutputMaxChars);
    const content = item?.content;
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) return content.map((part) => part?.text || '').join('');
    return '';
};

// 尾部保留量自适应:min(tailChars, 总量的 40%) —— 水位既然已经越线,这次压缩就必须
// 真的压掉大头;固定留 40k 时,历史刚超 40k 会把「早期部分」切得只剩一两条,
// 摘要模型如实总结出「什么都没发生」的假事实,而且水位不降,每一轮再来一次。
const splitAt = (history, tailChars) => {
    const total = history.reduce((sum, item) => sum + chars(item), 0);
    const tailKeep = Math.min(tailChars, Math.floor(total * 0.4));
    let at = history.length;
    let size = 0;
    while (at > 0 && (size < tailKeep || history.length - at < 2)) {
        at -= 1;
        size += chars(history[at]);
    }
    while (at > 0 && history[at]?.type === 'function_call_output') at -= 1;
    while (at > 0 && history[at - 1]?.type === 'function_call') at -= 1;
    return at;
};

/** 交给摘要的材料至少要有这么多字符 —— 只切出零头时压了也白压,还会生成误导性摘要。 */
const MATERIAL_MIN_CHARS = 1500;

const material = (items, config) => items
    .filter((item) => item?.type !== 'reasoning')
    .map((item, index) => `#${index + 1} ${item.role || item.type || 'unknown'}\n${text(item, config)}`)
    .join('\n\n---\n\n');

const mechanical = (items, config) => [
    '[早前对话的机械摘要]',
    ...items.map((item, index) => `#${index + 1} ${item.role || item.type || 'unknown'} ${text(item, config).replace(/\s+/g, ' ').slice(0, config.mechanicalItemMaxChars)}`),
].join('\n');

/** 用量是否已到压缩水位；满足水位后还需检查实际可压缩材料。 */
function shouldCompact({ usage, compaction }) {
    if (!compaction || typeof compaction !== 'object') throw new Error('compaction 配置必填');
    const used = (Number(usage?.input_tokens) || 0) + (Number(usage?.output_tokens) || 0);
    return Boolean(compaction.contextWindowTokens) && used >= compaction.contextWindowTokens * compaction.foldRatio;
}

export async function compact({
    history,
    usage,
    compaction,
    responsesUrl,
    apiKey,
    model,
    errorMaxChars,
    signal,
    onStart = () => {},
}) {
    if (!shouldCompact({ usage, compaction })) return { history, compacted: false };

    const at = splitAt(history, compaction.tailKeepChars);
    if (at < 2) return { history, compacted: false };

    const early = history.slice(0, at);
    // 材料太薄(比如只有首条用户消息,reasoning 被滤掉后一片空白)就不压:
    // 折叠不了多少上下文,却会往历史里塞一份「什么都没发生」的假事实
    const source = material(early, compaction);
    if (source.length < MATERIAL_MIN_CHARS) return { history, compacted: false };
    signal?.throwIfAborted();
    onStart();
    let summary = '';
    let kind = 'summary';
    let tokens = 0;
    try {
        const result = await complete({
            responsesUrl,
            apiKey,
            model,
            instructions: compaction.prompt,
            input: [{ role: 'user', content: `压缩下面的对话：\n\n${source}` }],
            errorMaxChars,
            signal,
        });
        tokens = (Number(result.usage?.input_tokens) || 0) + (Number(result.usage?.output_tokens) || 0);
        if (String(result.text).trim().length >= compaction.summaryMinChars) summary = String(result.text).trim();
    } catch (error) {
        if (signal?.aborted || error?.name === 'AbortError') throw error;
        // 摘要失败时使用确定性索引。
    }
    signal?.throwIfAborted();
    if (!summary) {
        summary = mechanical(early, compaction);
        kind = 'mechanical';
    }

    return {
        compacted: true,
        summary,
        kind,
        tokens,
        sourceCount: early.length,
        tailCount: history.length - at,
        history: [
            { role: 'user', content: `以下是历史上下文压缩摘要:\n\n${summary}` },
            ...history.slice(at),
        ],
    };
}

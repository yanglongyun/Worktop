import assert from 'node:assert/strict';
import test from 'node:test';
import { runAgent } from '../server/agent/index.js';

const compaction = {
    contextWindowTokens: 64000, foldRatio: 1, tailKeepChars: 40000,
    summaryMinChars: 80, callArgsMaxChars: 2000, callOutputMaxChars: 4000,
    mechanicalItemMaxChars: 160, prompt: '交接摘要',
};
const history = [
    { role: 'user', content: '以下是历史上下文压缩摘要:\n\n宿主路径 /example/host；用户要求保留现有文件。' },
    { role: 'assistant', content: '已确认的早期事实。'.repeat(600) },
    { role: 'assistant', content: '已完成验证。'.repeat(600) },
    { type: 'function_call', name: 'read', call_id: 'recent', arguments: '{"path":"/example/host"}' },
    { type: 'function_call_output', call_id: 'recent', output: '近期结果。'.repeat(1000) },
];
const response = (text) => new Response([
    { type: 'response.output_item.done', item: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text }] } },
    { type: 'response.completed', response: { status: 'completed', usage: { input_tokens: 100, output_tokens: 20 } } },
].map((event) => `data: ${JSON.stringify(event)}\n\n`).join(''));
const run = (input, events, extra = {}) => runAgent({
    runId: 'test', responsesUrl: 'http://mock.invalid/responses', apiKey: 'test', model: 'test',
    input, compaction, usage: { input_tokens: 65000, output_tokens: 100 },
    errorMaxChars: 1000, maxRounds: 1,
    run: async () => { throw new Error('不应执行工具'); },
    emit: (type, data) => events.push({ type, ...data }), ...extra,
});

for (const [name, input, extra] of [
    ['未达到阈值', history, { usage: { input_tokens: 100, output_tokens: 20 } }],
    ['早期条目不足', [{ role: 'user', content: '继续' }], {}],
    ['排除思考后材料不足', [
        { role: 'user', content: '目标' },
        { type: 'reasoning', summary: [{ type: 'summary_text', text: '思考'.repeat(10000) }] },
        { role: 'assistant', content: '最近回复' }, { role: 'user', content: '继续' },
    ], {}],
]) {
    test(`${name}：不发送压缩状态、不请求摘要、不替换历史`, async (t) => {
        const events = [], requests = [];
        t.mock.method(globalThis, 'fetch', async (_url, options) => {
            requests.push(JSON.parse(options.body));
            return response('继续工作');
        });
        await run(input, events, extra);
        assert.equal(requests.length, 1);
        assert.deepEqual(requests[0].input, input);
        assert.deepEqual(events.filter((event) => event.type === 'compact'), []);
    });
}

test('实际压缩：开始与完成各一次，旧摘要参与压缩，近期工具配对保留', async (t) => {
    const events = [], requests = [];
    const summary = '目标、路径和约束已保留，进度截至所提供的早期片段。'.repeat(5);
    t.mock.method(globalThis, 'fetch', async (_url, options) => {
        requests.push(JSON.parse(options.body));
        if (requests.length === 1) {
            assert.equal(events.at(-1).phase, 'started');
            return response(summary);
        }
        return response('继续工作');
    });
    await run(history, events);
    const compacted = events.filter((event) => event.type === 'compact');
    assert.deepEqual(compacted.map((event) => event.phase), ['started', 'done']);
    assert.equal(compacted[1].kind, 'summary');
    assert.match(requests[0].input[0].content, /宿主路径 \/example\/host/);
    assert.equal(requests[1].input[0].content, `以下是历史上下文压缩摘要:\n\n${summary}`);
    assert.deepEqual(requests[1].input.slice(-2), history.slice(-2));
});

test('取消摘要：不生成机械摘要、不发送压缩完成、不继续请求模型', async (t) => {
    const controller = new AbortController();
    const events = [];
    let requests = 0;
    t.mock.method(globalThis, 'fetch', async () => {
        requests += 1;
        controller.abort();
        throw controller.signal.reason;
    });
    await assert.rejects(run(history, events, { signal: controller.signal }), { name: 'AbortError' });
    assert.equal(requests, 1);
    assert.deepEqual(events.filter((event) => event.type === 'compact').map((event) => event.phase), ['started']);
    assert.equal(events.at(-1).status, 'aborted');
});

test('普通摘要失败仍可机械压缩并继续执行', async (t) => {
    const events = [];
    let requests = 0;
    t.mock.method(globalThis, 'fetch', async () => {
        requests += 1;
        return requests === 1 ? new Response('摘要不可用', { status: 400 }) : response('继续工作');
    });
    await run(history, events);
    assert.equal(requests, 2);
    const done = events.find((event) => event.type === 'compact' && event.phase === 'done');
    assert.equal(done.kind, 'mechanical');
    assert.equal(done.compacted, true);
});

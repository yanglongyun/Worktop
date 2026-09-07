// 重试判定。
//
// 判定顺序固定为：额度/账单(终态) → HTTP 状态码 → 错误文本兜底。
// 状态码是结构化的、可靠的；文本表只用来兜住 fetch 抛出的网络层和流层错误。
// 反过来做会误伤 —— 表里的 "500"、"429" 是裸子串，会命中 "max 500 tokens" 这类正文。
//
// 两张分类表移植自 earendil-works/pi (MIT)
// https://github.com/earendil-works/pi/blob/main/packages/ai/src/utils/retry.ts
// Copyright (c) 2025 Mario Zechner. Licensed under the MIT License.

const pattern = (parts) => new RegExp(parts.join('|'), 'i');

/** 账户额度、配额、账单耗尽。长得像限流，但重试多少次都不会好。 */
const NON_RETRYABLE = pattern([
    'insufficient_quota',
    'quota exceeded',
    'out of budget',
    'billing',
    'Monthly usage limit reached',
    'available balance',
    'GoUsageLimitError',
    'FreeUsageLimitError',
]);

/** 网络层与流层的瞬时故障。仅在拿不到 HTTP 状态码时作为兜底。 */
const RETRYABLE_TEXT = pattern([
    'overloaded',
    'rate.?limit',
    'too many requests',
    'service.?unavailable',
    'server.?error',
    'internal.?error',
    'provider.?returned.?error',
    'network.?error',
    'connection.?error',
    'connection.?refused',
    'connection.?lost',
    'other side closed',
    'fetch failed',
    'getaddrinfo',
    'ENOTFOUND',
    'EAI_AGAIN',
    'ECONNRESET',
    'ETIMEDOUT',
    'EPIPE',
    'upstream.?connect',
    'reset before headers',
    'socket hang up',
    'socket connection was closed',
    'timed? out',
    'timeout',
    'terminated',
    'websocket.?closed',
    'websocket.?error',
    'ended without',
    'stream ended before message_stop',
    'stream ended before a terminal response event',
    'http2 request did not get a response',
]);

/** 明确可以重试的 HTTP 状态码。其余 4xx 一律终态。 */
const RETRYABLE_STATUS = new Set([408, 409, 425, 429, 500, 502, 503, 504, 524]);

const DEFAULT_RETRY = Object.freeze({
    enabled: true,
    maxRetries: 3,
    baseDelayMs: 1_000,
    maxDelayMs: 30_000,
    /** 流已经吐出内容后再断，重试会产生重复正文。默认不重试，交给上层报错。 */
    retryAfterStream: false,
});

export function normalizeRetry(policy) {
    if (policy === false) return { ...DEFAULT_RETRY, enabled: false };
    return { ...DEFAULT_RETRY, ...(policy && typeof policy === 'object' ? policy : {}) };
}

/**
 * 这个错误值不值得再试一次。
 * @param error 抛出的错误，可带 `status`(HTTP 状态码)。
 */
export function isRetryable(error) {
    if (error?.name === 'AbortError') return false;
    const text = String(error?.message || error || '');
    if (NON_RETRYABLE.test(text)) return false;
    const status = Number(error?.status);
    if (Number.isInteger(status) && status > 0) return RETRYABLE_STATUS.has(status);
    return RETRYABLE_TEXT.test(text);
}

/** 指数退避加抖动。抖动上浮不超过基数的 25%，避免多路同时回源。 */
export function backoffMs(attempt, policy) {
    const raw = policy.baseDelayMs * 2 ** Math.max(0, attempt - 1);
    const capped = Math.min(policy.maxDelayMs, raw);
    return Math.round(capped * (1 + Math.random() * 0.25));
}

/** 可被 abort 打断的等待。 */
export function sleep(ms, signal) {
    if (signal?.aborted) return Promise.reject(new DOMException('Aborted', 'AbortError'));
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            signal?.removeEventListener('abort', onAbort);
            resolve();
        }, ms);
        const onAbort = () => {
            clearTimeout(timer);
            reject(new DOMException('Aborted', 'AbortError'));
        };
        signal?.addEventListener('abort', onAbort, { once: true });
    });
}

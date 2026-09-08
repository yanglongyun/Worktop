import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';

const source = readFileSync(new URL('../desktop/webviewPreload.cjs', import.meta.url), 'utf8');

function page({ reduced = false } = {}) {
    let now = 0, id = 0;
    const listeners = new Map(), timers = new Map(), frames = new Map(), sent = [];
    const element = () => ({
        style: {}, children: [], animations: [],
        append(...nodes) { this.children.push(...nodes); },
        appendChild(node) { this.append(node); },
        getAnimations() { return this.animations; },
        animate() { const a = { cancel() { a.cancelled = true; } }; this.animations.push(a); },
    });
    const body = element();
    const window = { innerWidth: 1000, innerHeight: 800 };
    window.top = window.self = window;
    runInNewContext(source, {
        window, document: { body, createElement: element },
        require: () => ({ ipcRenderer: {
            on: (name, fn) => listeners.set(name, fn),
            send: (...args) => sent.push(args),
        } }),
        performance: { now: () => now }, matchMedia: () => ({ matches: reduced }),
        setTimeout: (fn, ms) => { timers.set(++id, { fn, at: now + ms }); return id; },
        clearTimeout: (key) => timers.delete(key),
        requestAnimationFrame: (fn) => { frames.set(++id, fn); return id; },
    });
    return {
        sent, body,
        event: (name, data) => listeners.get(`worktop:${name}`)(null, data),
        opacity: () => Number(body.children[0].children[1].style.opacity),
        advance(ms, animate = true) {
            const until = now + ms;
            while (now < until) {
                now = Math.min(until, now + 16);
                for (const [key, timer] of [...timers]) if (timer.at <= now) {
                    timers.delete(key); timer.fn();
                }
                if (animate) {
                    const callbacks = [...frames.values()]; frames.clear();
                    callbacks.forEach(fn => fn(now));
                }
            }
        },
    };
}

test('只有移动、没有点击涟漪时也会淡出,下一次操作重新显示', () => {
    const p = page();
    p.event('cursor', { x: 80, y: 100, seq: 1, animate: true });
    p.advance(500);
    assert.ok(p.opacity() > 0.9);
    p.advance(2500);
    assert.ok(p.opacity() < 0.01);
    p.event('cursor', { x: 200, y: 100, seq: 2, animate: true });
    p.advance(500);
    assert.ok(p.opacity() > 0.9);
    assert.equal(p.body.children.length, 1);
});

test('连续操作和点击重新计算停留时间,旧计时不会隐藏新指针', () => {
    const p = page();
    p.event('cursor', { x: 80, y: 100, seq: 1, animate: false });
    p.advance(1500);
    p.event('cursor', { x: 90, y: 100, seq: 2, animate: false });
    p.advance(1000);
    assert.ok(p.opacity() > 0.9);
    p.event('cursor-pulse', { x: 90, y: 100 });
    p.advance(1000);
    assert.ok(p.opacity() > 0.9);
    p.advance(1800);
    assert.ok(p.opacity() < 0.01);
    assert.ok(p.body.children[0].children[0].animations.every(a => a.cancelled));
});

test('后台动画暂停时释放到达回执,减少动态效果模式也能隐藏', () => {
    const p = page();
    p.event('cursor', { x: 80, y: 100, seq: 1, animate: true });
    p.advance(500);
    p.event('cursor', { x: 900, y: 600, seq: 2, animate: true });
    p.advance(2000, false);
    assert.ok(p.sent.some(([name, seq]) => name === 'worktop:cursor-arrived' && seq === 2));
    p.advance(1000);
    assert.ok(p.opacity() < 0.01);

    const reduced = page({ reduced: true });
    reduced.event('cursor', { x: 80, y: 100, seq: 1, animate: true });
    reduced.advance(2000);
    assert.equal(reduced.opacity(), 0);
});

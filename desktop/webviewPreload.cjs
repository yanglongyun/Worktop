// 网页标签的 preload:AI 操作页面时的可见指针。
//
// AI 动手时,页面上有一个跟手滑过去的光标,**到达之后主进程才发真实的 CDP 点击**
// (到达回执由这里发回)。系统鼠标永远不碰 —— 这是页面覆盖层里画出来的。
//
// 为什么值得做:CDP 的输入是 isTrusted 的真实事件,和用户自己点没有区别 ——
// 也就是说**页面上会凭空发生事情而看不出是谁干的**。光标是把这件事显形。
//
// 三条约束:
//   · 只挂顶层 frame;pointer-events 全关,不挡任何真实命中
//   · prefers-reduced-motion 时永远瞬移
//   · 动画不阻塞正确性:主进程那边 800ms 兜底,这层挂了动作照常执行
(() => {
  if (window.top !== window.self) return;
  const { ipcRenderer } = require("electron");

  const FRAME_STEP = 1 / 240;
  const LONG_MOVE = 196;          // 超过这个距离走贝塞尔曲线,否则直线小挪
  const COLOR = "#2383e2";
  const REST_ROTATION = -8;
  const CURSOR_IDLE_MS = 1800;

  const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
  const dist = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);
  const lerp = (a, b, t) => a + (b - a) * t;

  // 自绘的箭头,不引外部素材。热点在 (0,0),所以容器直接摆到目标点上。
  const ASSET = "data:image/svg+xml;utf8," + encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="22" height="26" viewBox="0 0 22 26">
       <path d="M1 1 L1 20 L6.2 15.2 L9.6 23.4 L13.2 21.9 L9.8 13.9 L17 13.6 Z"
             fill="#fff" stroke="#1a1a1a" stroke-width="1.4" stroke-linejoin="round"/>
     </svg>`);

  // ── 弹簧 ────────────────────────────────────────────────────────────
  const spring = (value, response, damping) =>
    ({ value, target: value, velocity: 0, force: 0, response, damping, pending: 0 });

  const forceTo = (s, value) => { s.value = value; s.target = value; s.velocity = 0; s.force = 0; s.pending = 0; };

  const advance = (s, dt) => {
    const response = Math.max(0.001, s.response);
    const stiffness = Math.min((Math.PI * 2) ** 2 / response ** 2, 1 / (2 * FRAME_STEP ** 2));
    const damping = Math.sqrt(stiffness) * 2 * s.damping;
    s.pending = Math.min(s.pending + dt, 0.12);
    while (s.pending >= FRAME_STEP) {
      const half = FRAME_STEP / 2;
      const midV = s.velocity + s.force * half;
      s.value += midV * FRAME_STEP;
      s.force = -midV * damping + (s.target - s.value) * stiffness;
      s.velocity = midV + s.force * half;
      s.pending -= FRAME_STEP;
    }
    if (Math.abs(s.target - s.value) < 0.01 && Math.abs(s.velocity) < 0.06) {
      s.value = s.target; s.velocity = 0; s.force = 0;
    }
  };

  const bezier = (path, t) => {
    const u = 1 - t;
    return {
      x: u ** 3 * path.start.x + 3 * u ** 2 * t * path.c1.x + 3 * u * t ** 2 * path.c2.x + t ** 3 * path.end.x,
      y: u ** 3 * path.start.y + 3 * u ** 2 * t * path.c1.y + 3 * u * t ** 2 * path.c2.y + t ** 3 * path.end.y,
    };
  };

  /** 人手划过去的弧线:直线太机械,而且看不出方向感。 */
  const humanCurve = (start, end) => {
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const len = Math.max(1, Math.hypot(dx, dy));
    const normal = { x: -dy / len, y: dx / len };
    const dir = Math.sin(start.x * 0.017 + end.y * 0.013) >= 0 ? 1 : -1; // 弯向哪边随位置定,不随机(重放一致)
    const bend = clamp(len * 0.16, 22, 90) * dir;
    return {
      start,
      c1: { x: lerp(start.x, end.x, 0.3) + normal.x * bend, y: lerp(start.y, end.y, 0.3) + normal.y * bend },
      c2: { x: lerp(start.x, end.x, 0.72) + normal.x * bend * 0.45, y: lerp(start.y, end.y, 0.72) + normal.y * bend * 0.45 },
      end,
    };
  };

  // ── 光标 ────────────────────────────────────────────────────────────
  let c = null;
  let idleTimer = null;

  const ensureCursor = () => {
    if (c || !document.body) return c;
    const layer = document.createElement("div");
    Object.assign(layer.style, {
      position: "fixed", inset: "0", overflow: "hidden",
      pointerEvents: "none", zIndex: "2147483646",
    });
    const node = document.createElement("div");
    Object.assign(node.style, {
      position: "absolute", left: "0", top: "0", width: "22px", height: "26px",
      opacity: "0",
      transformOrigin: "2px 2px", willChange: "transform, opacity, filter",
    });
    const img = document.createElement("img");
    img.alt = ""; img.draggable = false; img.src = ASSET;
    img.style.display = "block";
    img.style.filter = `drop-shadow(0 0 6px ${COLOR}cc) drop-shadow(0 0 14px ${COLOR}66)`;
    node.appendChild(img);

    const ripple = document.createElement("div");
    Object.assign(ripple.style, {
      position: "absolute", width: "14px", height: "14px",
      border: `2px solid ${COLOR}`, borderRadius: "999px", opacity: "0", pointerEvents: "none",
    });
    layer.append(ripple, node);
    document.body.append(layer);

    c = {
      node, ripple,
      pos: { x: window.innerWidth * 0.58, y: window.innerHeight * 0.55 },
      rotation: 0, motion: null, thinkAt: null, onArrive: null,
      frame: null, lastTime: performance.now(),
      x: null, y: null,
      visible: spring(0, 0.42, 0.86),
      progress: spring(0, 0.1, 0.86),
    };
    c.x = spring(c.pos.x, 0.19, 0.9);
    c.y = spring(c.pos.y, 0.19, 0.9);
    return c;
  };

  const render = () => {
    const speed = Math.hypot(c.x.velocity, c.y.velocity);
    const stretch = clamp(1 - speed / 5500, 0.65, 1);   // 快的时候略拉长,像有惯性
    const opacity = clamp(c.visible.value, 0, 1);
    const scale = lerp(0.4, 1, opacity);
    c.node.style.opacity = String(opacity);
    c.node.style.filter = `blur(${lerp(5, 0, opacity)}px)`;
    c.node.style.transform =
      `translate3d(${c.pos.x - 2}px, ${c.pos.y - 2}px, 0) rotate(${REST_ROTATION + c.rotation}deg) scale(${stretch * scale}, ${scale})`;
  };

  const ensureFrame = () => { if (!c.frame) c.frame = requestAnimationFrame(tick); };

  // 指针只表示近期浏览器操作,不常驻网页。每次操作重新计时,也覆盖只有 hover 或操作失败的情况。
  const scheduleHide = () => {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      idleTimer = null;
      c.motion = null; c.thinkAt = null; c.rotation = 0;
      const done = c.onArrive; c.onArrive = null;
      done?.(); // 后台页动画可能暂停,不能让到达回执悬着
      c.ripple.getAnimations().forEach((a) => a.cancel());
      c.visible.target = 0;
      if (matchMedia("(prefers-reduced-motion: reduce)").matches) forceTo(c.visible, 0);
      render();
      ensureFrame();
    }, CURSOR_IDLE_MS);
  };

  function tick(time) {
    c.frame = null;
    const dt = clamp((time - c.lastTime) / 1000, 1 / 120, 1 / 20);
    c.lastTime = time;
    advance(c.visible, dt);

    if (c.motion) {
      advance(c.progress, dt);
      const p = clamp(c.progress.value, 0, 1);
      if (c.motion.mode === "bezier") {
        const sample = bezier(c.motion.path, p);
        c.x.target = sample.x; c.y.target = sample.y;
      } else {
        c.x.target = c.motion.target.x; c.y.target = c.motion.target.y;
      }
      // 移动中只轻微侧倾,不跟着路径打转 —— 转起来像风车,反而看不清指向
      const wave = Math.sin(p * Math.PI);
      const from = c.motion.mode === "bezier" ? c.motion.path.start.x : c.motion.start.x;
      const to = c.motion.mode === "bezier" ? c.motion.path.end.x : c.motion.target.x;
      c.rotation = clamp((to - from) / 60, -7, 7) * wave;
      advance(c.x, dt); advance(c.y, dt);
      c.pos = { x: c.x.value, y: c.y.value };

      const arrived = p > 0.999 && dist(c.pos, c.motion.target) < 0.85
        && Math.abs(c.x.velocity) < 12 && Math.abs(c.y.velocity) < 12;
      if (arrived) {
        c.pos = { ...c.motion.target };
        forceTo(c.x, c.pos.x); forceTo(c.y, c.pos.y);
        c.motion = null; c.rotation = 0;
        c.thinkAt = performance.now();   // 到达即进入轻微摆动,像在确认目标
        const done = c.onArrive; c.onArrive = null;
        done?.();
      }
    }

    if (!c.motion && c.thinkAt != null) {
      const s = (time - c.thinkAt) / 1000;
      const envelope = Math.sin(Math.min(1, s / 1.6) * Math.PI);
      c.rotation = Math.sin((s / 0.66) * Math.PI * 2) * envelope * 12.5;
      if (s >= 1.6) { c.thinkAt = null; c.rotation = 0; }
    }

    render();
    if (c.motion || c.thinkAt != null || Math.abs(c.visible.target - c.visible.value) > 0.001) ensureFrame();
  }

  const jumpTo = (target) => {
    c.motion = null; c.onArrive = null;
    c.pos = { ...target };
    forceTo(c.x, target.x); forceTo(c.y, target.y);
    render();
  };

  ipcRenderer.on("worktop:cursor", (_event, { x, y, seq, animate }) => {
    if (!ensureCursor()) return;
    scheduleHide();
    const target = {
      x: clamp(Number(x) || 0, 0, window.innerWidth),
      y: clamp(Number(y) || 0, 0, window.innerHeight),
    };
    // 首次出现原地浮现:还看不见的时候不该飞一段假旅程
    const firstShow = c.visible.value <= 0.001;
    c.visible.target = 1;
    c.thinkAt = null;
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!animate || reduced || firstShow) {
      jumpTo(target);
      ensureFrame();
      ipcRenderer.send("worktop:cursor-arrived", seq);
      return;
    }
    // 新指令顶掉旧动画,旧的到达回执作废 —— 否则两次移动的回执会串
    const start = { ...c.pos };
    const long = dist(start, target) > LONG_MOVE;
    c.progress = spring(0, long ? 0.1 : 0.19, long ? 0.86 : 0.94);
    c.progress.target = 1;
    c.motion = long
      ? { mode: "bezier", path: humanCurve(start, target), target }
      : { mode: "scoot", start, target };
    c.onArrive = () => ipcRenderer.send("worktop:cursor-arrived", seq);
    ensureFrame();
  });

  ipcRenderer.on("worktop:cursor-pulse", (_event, { x, y }) => {
    if (!ensureCursor()) return;
    scheduleHide();
    // 涟漪画在**真实落点**上 —— 即便光标是瞬移过去的,「点了哪里」也要看得见
    if (Number.isFinite(x) && Number.isFinite(y) && dist(c.pos, { x, y }) > 2) jumpTo({ x, y });
    c.ripple.getAnimations().forEach((a) => a.cancel());
    c.ripple.style.left = `${c.pos.x - 7}px`;
    c.ripple.style.top = `${c.pos.y - 7}px`;
    c.ripple.animate(
      [{ transform: "scale(.35)", opacity: 0.9 }, { transform: "scale(2.7)", opacity: 0 }],
      { duration: 360, easing: "cubic-bezier(.2,.8,.2,1)" },
    );
  });
})();

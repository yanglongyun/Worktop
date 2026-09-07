// app 子进程的生死:启动、健康判定、崩溃退避重启、空闲回收。
//
// 两种 run.mode:
//   on-demand  取址时才起,闲了回收 —— 装 20 个 app 不等于开机 20 个进程
//   always     随宿主启动,崩了重启,不做空闲回收
// 纯静态 app(无 run)也在这里管:给它起一个极小的静态服务 ——
// **每个 app 一个真 origin,无例外**。否则它写 href="/style.css" 这种绝对路径就 404
// (这个坑 0.8.0 用路径前缀挂载时踩过一次,不再踩第二次)。
//
// 健康判定:起进程不算数,health 应答 2xx 才算数。
import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createReadStream, existsSync, mkdirSync, statSync } from "node:fs";
import http from "node:http";
import net from "node:net";
import path from "node:path";
import { emit } from "../bus.js";
import { appDataHome, getApp, listApps, type AppDef } from "./registry.js";

const LOG_LINES = 200;
const MAX_RESTARTS = 3;
const IDLE_SWEEP_MS = 30_000;
const KILL_GRACE_MS = 5_000;
// 启动的两条时限:没人应答用短的,一旦应答过(=活着,在初始化)换成长的。
// 数字全是宿主策略,契约只规定 health 的三态语义。
const CONNECT_TIMEOUT_MS = 10_000;
const INIT_TIMEOUT_MS = 180_000;

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg",
  ".ico": "image/x-icon", ".woff2": "font/woff2", ".txt": "text/plain; charset=utf-8",
};

type Status = "stopped" | "starting" | "ready" | "failed";
type LogLine = { stream: "stdout" | "stderr"; line: string; at: string };

type Record_ = {
  id: string;
  status: Status;
  port: number;
  token: string;
  proc: ChildProcess | http.Server | null;
  kind: "process" | "static";
  logs: LogLine[];
  error: string;
  restarts: number;
  lastUsed: number;
  starting: Promise<Record_> | null;
  intentional: boolean;
};

const records = new Map<string, Record_>();
const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));

/** 让内核挑一个空闲端口,拿到号再让开。理论上有竞态,拿不到由启动失败兜住。 */
const freePort = (): Promise<number> => new Promise((done, fail) => {
  const probe = net.createServer();
  probe.unref();
  probe.on("error", fail);
  probe.listen(0, "127.0.0.1", () => {
    const port = (probe.address() as net.AddressInfo).port;
    probe.close(() => done(port));
  });
});

const recordFor = (id: string): Record_ => {
  let record = records.get(id);
  if (!record) {
    record = {
      id, status: "stopped", port: 0,
      token: randomBytes(24).toString("hex"),
      proc: null, kind: "process", logs: [], error: "",
      restarts: 0, lastUsed: Date.now(), starting: null, intentional: false,
    };
    records.set(id, record);
  }
  return record;
};

const setStatus = (record: Record_, status: Status, error = "", reason = "") => {
  record.status = status;
  record.error = error;
  // reason:"manual" = 用户按了停止(界面据此关掉那张标签);"idle" = 闲置回收(标签留着)
  emit({ type: "app_status", appId: record.id, status, error, port: record.port, reason });
};

const log = (record: Record_, stream: LogLine["stream"], chunk: unknown) => {
  for (const line of String(chunk).split("\n")) {
    if (!line.trim()) continue;
    record.logs.push({ stream, line: line.slice(0, 2000), at: new Date().toISOString() });
  }
  if (record.logs.length > LOG_LINES) record.logs.splice(0, record.logs.length - LOG_LINES);
};

const lastError = (record: Record_) =>
  record.logs.filter((e) => e.stream === "stderr").slice(-3).map((e) => e.line).join(" / ");

/**
 * health 是三态的(契约条款):
 *   连不上         还没开始监听,或者已经死了
 *   2xx            就绪
 *   其它 HTTP 应答  活着、正在初始化 —— 宿主应继续等
 *
 * 所以时限也是两条:一直没人应答就按启动失败算;只要应答过一次,
 * 说明进程活着只是还没起好(重型引擎、要预热的东西),换成宽得多的初始化上限。
 * 慢启动因此不必祈祷宿主把常量调大 —— 它自己就能表达。
 */
const waitHealthy = async (record: Record_, app: AppDef) => {
  const url = `http://127.0.0.1:${record.port}${app.run!.health}`;
  const started = Date.now();
  let deadline = started + CONNECT_TIMEOUT_MS;
  let initializing = false;
  while (Date.now() < deadline) {
    const child = record.proc as ChildProcess | null;
    if (!child || child.exitCode !== null) throw new Error(lastError(record) || "进程启动后立即退出");
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1500) });
      if (response.ok) return;
      if (!initializing) {
        initializing = true;
        deadline = started + INIT_TIMEOUT_MS;
        setStatus(record, "starting", "应用正在初始化…");
      }
    } catch { /* 还没开始监听,继续等 */ }
    await sleep(150);
  }
  const cap = (initializing ? INIT_TIMEOUT_MS : CONNECT_TIMEOUT_MS) / 1000;
  throw new Error(`${cap} 秒内没有通过健康检查(${app.run!.health})`);
};

/** 纯静态 app:宿主替它当那个「网站」。目录根即站点根,未命中回落 index.html。 */
const launchStatic = (app: AppDef, record: Record_): Promise<Record_> =>
  new Promise((done, fail) => {
    const server = http.createServer((request, response) => {
      record.lastUsed = Date.now();
      const pathname = decodeURIComponent(new URL(request.url || "/", "http://x").pathname);
      const base = path.resolve(app.dir);
      let file = path.resolve(base, `.${pathname}`);
      if (!file.startsWith(base) || !existsSync(file) || statSync(file).isDirectory()) {
        file = path.join(base, "index.html");
      }
      if (!existsSync(file)) { response.writeHead(404); response.end(); return; }
      response.writeHead(200, { "content-type": MIME[path.extname(file)] || "application/octet-stream" });
      createReadStream(file).pipe(response);
    });
    server.on("error", fail);
    server.listen(0, "127.0.0.1", () => {
      record.port = (server.address() as net.AddressInfo).port;
      record.proc = server;
      record.kind = "static";
      record.restarts = 0;
      setStatus(record, "ready");
      done(record);
    });
  });

const launch = async (app: AppDef): Promise<Record_> => {
  const record = recordFor(app.id);
  record.intentional = false;
  setStatus(record, "starting");

  if (!app.run) return launchStatic(app, record);

  const dataDir = path.resolve(path.join(appDataHome(), app.id));
  mkdirSync(dataDir, { recursive: true });
  record.port = await freePort();
  record.kind = "process";

  const child = spawn(app.run.command, app.run.args, {
    cwd: app.dir,
    env: {
      ...process.env,
      PORT: String(record.port),
      // 绑定地址由宿主指定(契约):本机宿主给 loopback,容器等沙箱宿主给别的
      HOST: "127.0.0.1",
      APP_ID: app.id,
      APP_DATA_DIR: dataDir,
      HOST_URL: `http://127.0.0.1:${process.env.WORKTOP_PORT || ""}`,
      APP_TOKEN: record.token,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  record.proc = child;
  child.stdout?.on("data", (chunk) => log(record, "stdout", chunk));
  child.stderr?.on("data", (chunk) => log(record, "stderr", chunk));
  child.on("error", (error) => log(record, "stderr", `spawn 失败:${error.message}`));
  child.on("exit", (code, signal) => void onExit(app, record, code, signal));

  try {
    await waitHealthy(record, app);
    record.restarts = 0;
    record.lastUsed = Date.now();
    setStatus(record, "ready");
  } catch (error: any) {
    record.intentional = true;
    child.kill("SIGKILL");
    record.proc = null;
    setStatus(record, "failed", String(error?.message || error));
    throw error;
  }
  return record;
};

/** 非预期退出才重启。退避 1s / 2s / 4s,连续三次仍不行就认输。 */
const onExit = async (app: AppDef, record: Record_, code: number | null, signal: string | null) => {
  record.proc = null;
  if (record.intentional) { setStatus(record, "stopped"); return; }
  log(record, "stderr", `进程退出(code=${code} signal=${signal || "-"})`);
  if (record.restarts >= MAX_RESTARTS) {
    setStatus(record, "failed", `连续 ${MAX_RESTARTS} 次崩溃,已停止重启。${lastError(record)}`);
    return;
  }
  const delay = 1000 * 2 ** record.restarts;
  record.restarts += 1;
  setStatus(record, "starting", `第 ${record.restarts} 次重启,等待 ${delay / 1000}s`);
  await sleep(delay);
  if (record.intentional) return;
  record.starting = launch(app).finally(() => { record.starting = null; });
  await record.starting.catch(() => { /* launch 里已记状态 */ });
};

export const stopApp = async (id: string, reason: "manual" | "idle" = "manual") => {
  const record = records.get(id);
  if (!record?.proc) { if (record) setStatus(record, "stopped", "", reason); return false; }
  record.intentional = true;
  if (record.kind === "static") {
    (record.proc as http.Server).close();
    record.proc = null;
    setStatus(record, "stopped", "", reason);
    return true;
  }
  const child = record.proc as ChildProcess;
  child.kill("SIGTERM");
  const deadline = Date.now() + KILL_GRACE_MS;
  while (record.proc && Date.now() < deadline) await sleep(100);
  if (record.proc) child.kill("SIGKILL");
  setStatus(record, "stopped", "", reason);
  return true;
};

/** 取址即保活:没起就拉起,起着就续命。界面和 agent 都走它。 */
export const ensureApp = async (id: string): Promise<Record_> => {
  const app = getApp(id);
  if (!app) throw Object.assign(new Error(`没有这个应用:${id}`), { status: 404 });
  if (app.invalid) throw Object.assign(new Error(app.invalid), { status: 409 });

  const record = recordFor(id);
  record.lastUsed = Date.now();
  if (record.status === "ready" && record.proc) return record;
  if (record.starting) return record.starting;

  record.restarts = 0;
  record.starting = launch(app).finally(() => { record.starting = null; });
  return record.starting;
};

export const restartApp = async (id: string) => { await stopApp(id, "idle"); return ensureApp(id); };
export const touchApp = (id: string) => { const r = records.get(id); if (r) r.lastUsed = Date.now(); };

export const appStatus = (id: string) => {
  const app = getApp(id);
  if (app?.invalid) return { status: "invalid" as const, error: app.invalid, port: 0 };
  const record = records.get(id);
  return { status: record?.status || ("stopped" as const), error: record?.error || "", port: record?.port || 0 };
};

/** app 作用域凭证。与进程无关 —— 纯静态 app 也要能调宿主能力。 */
/** 反查:token → appId。/host/* 靠它认身份,路径里不带 id。 */
export const identifyApp = (token: string) => {
  if (!token) return "";
  for (const record of records.values()) if (record.token === token) return record.id;
  return "";
};

/**
 * 回收前先问一声(契约条款)。
 *
 * 必须问,因为 lastUsed 只反映取址和 /host/* 调用 —— **浏览器是直连 app 自己的
 * origin 的,那些流量宿主根本看不见**。用户正开着应用干活,在宿主眼里和闲置十分钟
 * 一模一样,不问就杀是错的。app 在 health 里应答 `{"busy": true}` 即推迟回收。
 *
 * 应答不是 JSON 也无所谓:解析失败按「不忙」算 —— 契约的最小示例就返回纯文本 ok,
 * 拿它当 JSON 解析会炸,那是宿主的错,不是 app 的。
 */
const recycle = async (record: Record_, app: AppDef) => {
  try {
    const response = await fetch(`http://127.0.0.1:${record.port}${app.run!.health}`,
      { signal: AbortSignal.timeout(1500) });
    if (response.ok) {
      const body: any = await response.json().catch(() => null);
      if (body?.busy === true) { record.lastUsed = Date.now(); return; }
    }
  } catch { /* 连 health 都不应答了,回收没商量 */ }
  await stopApp(record.id, "idle");
};

// 空闲回收:只回收 on-demand 的进程。always 与静态服务不回收
const sweep = setInterval(() => {
  for (const record of records.values()) {
    if (record.status !== "ready" || record.kind !== "process") continue;
    const app = getApp(record.id);
    if (!app?.run || app.run.mode === "always") continue;
    const idle = app.run.idleTimeoutMs || 0;
    if (idle > 0 && Date.now() - record.lastUsed > idle) void recycle(record, app);
  }
}, IDLE_SWEEP_MS);
sweep.unref?.();

/** run.mode: "always" 的启动组 —— 宿主起来时把它们全拉起。 */
export const startAlwaysApps = async () => {
  const eager = listApps().filter((a) => a.run?.mode === "always" && !a.invalid);
  await Promise.all(eager.map((a) => ensureApp(a.id).catch(() => { /* 状态已记录 */ })));
  return eager.map((a) => a.id);
};

export const stopAllApps = async () => {
  clearInterval(sweep);
  await Promise.all([...records.keys()].map((id) => stopApp(id)));
};

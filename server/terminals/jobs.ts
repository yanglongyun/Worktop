import { executionDirectory } from "../agent/paths.js";
import { DATA_HOME } from "../system/paths.js";
// 后台任务注册表:`bash` 工具 background:true 时,进程交给这里托管 ——
// 立即返回 id/pid/日志路径,之后可查状态、读日志、停止。
//
// 曾经它是 0.5~0.9 的「预览机制」后端(ProcessPanel / process 标签 / /api/processes),
// 那套在 0.10.0 拔掉了,但**它没被删,是转岗了**:现在唯一的使用者是 tools/bash.ts。
// 1.1.0 从 processes.ts 改名为 jobs.ts,免得下次读代码的人当成残渣顺手删掉。
//
// 记录**故意只在内存**:它描述的是当前这个服务进程,不是项目的持久状态 ——
// 服务重启后进程本就没了,落库只会留下一堆假的「运行中」。
import { spawn, type ChildProcess } from "child_process";
import { randomUUID } from "crypto";
import { createWriteStream, existsSync, mkdirSync } from "fs";
import { join } from "path";
import type { WriteStream } from "fs";
import { emit } from "../bus.js";

/** 一条后台任务的全部状态。child/logStream 是句柄,只在本模块内用,不出网。 */
type Job = {
  id: string;
  command: string;
  cwd: string;
  reason: string;
  child: ChildProcess;
  pid: number | undefined;
  status: "running" | "stopped" | "exited" | "error";
  started_at: string;
  ended_at: string | null;
  exit_code: number | null;
  signal: NodeJS.Signals | null;
  stopping: boolean;
  ports: number[];
  preview_url: string | null;
  output: string;
  log_file: string | null;
  logStream: WriteStream | null;
};

const MAX_LOG_CHARS = 200_000;
const DEFAULT_TAIL = 40_000;

// 日志同时落文件:bash background 启动后,模型用 read/tail 日志文件看输出,
// 不需要专门的「读进程日志」工具(6 工具体系的闭环)。
const LOG_DIR = join(DATA_HOME, "logs", "processes");

const SHELL_CANDIDATES = [process.env.SHELL, "/bin/zsh", "/bin/bash", "/bin/sh"];
const resolveShell = () => {
  for (const s of SHELL_CANDIDATES) {
    const v = String(s || "").trim();
    if (v && existsSync(v)) return v;
  }
  return undefined;
};

const processes = new Map<string, Job>();
const emitTimers = new Map<string, NodeJS.Timeout>();

const stripAnsi = (text: unknown) =>
  String(text || "").replace(
    // eslint-disable-next-line no-control-regex
    /[\u001b\u009b][[\]()#;?]*(?:(?:(?:[a-zA-Z\d]*(?:;[a-zA-Z\d]*)*)?\u0007)|(?:(?:\d{1,4}(?:;\d{0,4})*)?[\dA-PR-TZcf-nq-uy=><~]))/g,
    "",
  );

const unique = <T,>(items: T[]) => Array.from(new Set(items.filter(Boolean)));

const urlsFromText = (text: unknown): string[] => {
  const urls: string[] = [];
  const re = /https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(?::\d+)?(?:\/[^\s"'<>)]*)?/gi;
  let m;
  while ((m = re.exec(String(text || "")))) {
    urls.push(m[0].replace("0.0.0.0", "127.0.0.1").replace("[::1]", "127.0.0.1"));
  }
  return urls;
};

const portsFromText = (text: unknown): number[] => {
  const ports: number[] = [];
  const raw = String(text || "");
  const patterns = [
    /(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]):(\d{2,5})/gi,
    /\b(?:port|PORT)\s*(?:=|:|on|at)?\s*(\d{2,5})\b/g,
    /--port\s+(\d{2,5})\b/g,
    /-p\s+(\d{2,5})\b/g,
    /http\.server\s+(\d{2,5})\b/g,
  ];
  for (const re of patterns) {
    let m;
    while ((m = re.exec(raw))) {
      const port = Number(m[1]);
      if (port > 0 && port <= 65535) ports.push(port);
    }
  }
  return unique(ports);
};

const inferPreviewUrl = (record: Job): string | null => {
  const urls = urlsFromText(`${record.command}\n${record.output || ""}`);
  if (urls.length) return urls[0];
  const ports = unique([...portsFromText(record.command), ...portsFromText(record.output || "")]);
  record.ports = ports;
  return ports.length ? `http://127.0.0.1:${ports[0]}` : null;
};

const publicProcess = (record: Job | undefined, { tail = DEFAULT_TAIL }: { tail?: number } = {}) => {
  if (!record) return null;
  const output = String(record.output || "");
  return {
    id: record.id,
    command: record.command,
    cwd: record.cwd,
    reason: record.reason || "",
    pid: record.pid || null,
    status: record.status,
    started_at: record.started_at,
    ended_at: record.ended_at || null,
    exit_code: record.exit_code ?? null,
    signal: record.signal || null,
    ports: record.ports || [],
    preview_url: record.preview_url || null,
    log_file: record.log_file || null,
    output: tail === 0 ? "" : output.slice(-Math.max(0, Number(tail) || DEFAULT_TAIL)),
  };
};

const scheduleEmit = (record: Job, immediate = false) => {
  const send = () => {
    emitTimers.delete(record.id);
    emit({ type: "process_changed", process: publicProcess(record, { tail: 20_000 }) });
  };
  if (immediate) {
    const pending = emitTimers.get(record.id);
    if (pending) clearTimeout(pending);
    send();
    return;
  }
  if (emitTimers.has(record.id)) return;
  emitTimers.set(record.id, setTimeout(send, 250));
};

const appendLog = (record: Job, chunk: string) => {
  if (!chunk) return;
  const clean = stripAnsi(chunk);
  record.output = `${record.output || ""}${clean}`;
  if (record.output.length > MAX_LOG_CHARS) record.output = record.output.slice(-MAX_LOG_CHARS);
  try { record.logStream?.write(clean); } catch { /* 日志文件写不进不拦运行 */ }
  record.preview_url = inferPreviewUrl(record);
  scheduleEmit(record);
};

const startProcess = ({ command, cwd: requestedCwd, reason = "" }: { command: string; cwd?: string; reason?: string }) => {
  const cmd = String(command || "").trim();
  if (!cmd) throw new Error("command is required");

  const cwd = executionDirectory(requestedCwd);
  const id = randomUUID().slice(0, 8);
  const shell = resolveShell();
  const child = spawn(cmd, {
    cwd,
    shell,
    detached: process.platform !== "win32",
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, FORCE_COLOR: "0" },
  });

  let logStream: WriteStream | null = null;
  let logFile: string | null = null;
  try {
    mkdirSync(LOG_DIR, { recursive: true });
    logFile = join(LOG_DIR, `${id}.log`);
    logStream = createWriteStream(logFile, { flags: "a" });
    logStream.write(`# ${cmd}\n# cwd: ${cwd}\n# started: ${new Date().toISOString()}\n\n`);
  } catch { /* 开不出日志文件也照常跑,只是少了文件视角 */ }

  const record: Job = {
    id,
    command: cmd,
    cwd,
    reason: String(reason || ""),
    child,
    pid: child.pid,
    status: "running",
    started_at: new Date().toISOString(),
    ended_at: null,
    exit_code: null,
    signal: null,
    stopping: false,
    ports: portsFromText(cmd),
    preview_url: null,
    output: "",
    log_file: logFile,
    logStream,
  };
  record.preview_url = inferPreviewUrl(record);
  processes.set(id, record);

  child.stdout?.on("data", (d) => appendLog(record, d.toString("utf8")));
  child.stderr?.on("data", (d) => appendLog(record, d.toString("utf8")));
  child.on("error", (error: Error) => {
    record.status = "error";
    record.ended_at = new Date().toISOString();
    appendLog(record, `\n[process error] ${error.message}\n`);
    try { record.logStream?.end(); } catch { /* noop */ }
    scheduleEmit(record, true);
  });
  child.on("exit", (code: number | null, signal: NodeJS.Signals | null) => {
    record.ended_at = new Date().toISOString();
    record.exit_code = code;
    record.signal = signal;
    // 被信号杀掉(包括外部 bash kill)算「停止」,不算报错
    record.status = record.stopping || signal ? "stopped" : code === 0 ? "exited" : "error";
    appendLog(record, `\n[process ${record.status}${code == null ? "" : ` code=${code}`}${signal ? ` signal=${signal}` : ""}]\n`);
    try { record.logStream?.end(); } catch { /* noop */ }
    scheduleEmit(record, true);
  });
  child.unref?.();
  scheduleEmit(record, true);
  return publicProcess(record);
};

const getProcess = (id: string, opts: { tail?: number } = {}) => publicProcess(processes.get(String(id || "")), opts);

const LONG_RUNNING_RE =
  /\b(npm|pnpm|yarn|bun)\s+(run\s+)?(dev|start|serve)\b|\b(vite|next|nuxt|astro|remix)\s+dev\b|\bwrangler\s+dev\b|\bpython\d?\s+-m\s+http\.server\b|\b(http-server|serve)\b|\bflask\s+run\b|\buvicorn\b|\bdjango-admin\s+runserver\b|\brails\s+(server|s)\b|\bbin\/rails\s+s\b/i;

const EXPLICIT_BACKGROUND_RE = /(^|\s)(&|nohup|pm2|forever)\b|\bdocker\s+compose\s+up\s+-d\b/i;

const looksLongRunning = (command: unknown) =>
  LONG_RUNNING_RE.test(String(command || "")) && !EXPLICIT_BACKGROUND_RE.test(String(command || ""));

export { startProcess, getProcess, looksLongRunning };

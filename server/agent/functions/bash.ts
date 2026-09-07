// @ts-nocheck
// bash:唯一的命令工具。
//   - 前台:在工作目录跑会结束的命令,返回输出(spawn + 进程组,超时/停止杀整组)。
//   - background:true:转交进程注册表(processes.ts)—— 立即返回 id/pid/日志文件路径,
//     读日志用 read/tail 日志文件,停止用 bash kill。dev server 一类命令即使忘了
//     background 也会被自动识别转后台,别让模型卡死自己。
import { spawn } from "child_process";
import { executionDirectory } from "../paths.js";
import { existsSync } from "fs";
import { getProcess, looksLongRunning, startProcess } from "../../terminals/jobs.js";

const SHELL_CANDIDATES = [process.env.SHELL, "/bin/zsh", "/bin/bash", "/bin/sh"];
const resolveShell = () => {
  for (const candidate of SHELL_CANDIDATES) {
    const value = String(candidate || "").trim();
    if (value && existsSync(value)) return value;
  }
  return "/bin/sh";
};

const TIMEOUT_MS = Math.max(5000, Number(process.env.WORKTOP_SHELL_TIMEOUT_MS) || 120_000);
const RAW_MAX = 200_000; // 收集上限,只是内存护栏;给模型的截断在工具装配层统一做

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const formatProcess = (record, prefix = "started background process") => {
  if (!record) return "process not found";
  const lines = [
    `${prefix}: id=${record.id}${record.pid ? ` pid=${record.pid}` : ""} status=${record.status}`,
    `command: ${record.command}`,
  ];
  if (record.log_file) lines.push(`log: ${record.log_file}(读日志用 read 或 bash tail;停止用 bash: kill ${record.pid ?? "<pid>"})`);
  if (record.preview_url) lines.push(`preview: ${record.preview_url}`);
  if (record.output) lines.push(`\nlatest output:\n${record.output.slice(-4000)}`);
  return lines.join("\n");
};

export const bashDef = {
  type: "function",
  name: "bash",
  description:
    "执行本机 shell 命令,默认从用户主目录开始;可用 cwd 指定本次目录。会结束的命令(git/build/ls/grep/装依赖)直接跑并返回输出;" +
    "长驻进程(dev server/watch/serve)必须 background:true —— 立即返回进程 id、pid 和日志文件路径,不阻塞;" +
    "之后用 read 读日志文件、用 kill <pid> 停止。读写单个文件优先用 read/edit/write(更省 token)。",
  parameters: {
    type: "object",
    properties: {
      summary: { type: "string", description: "一句话说明这次执行的目的(界面会显示)" },
      command: { type: "string", description: "要执行的命令" },
      cwd: { type: "string", description: "可选:本次命令执行目录,支持绝对路径或 ~/;每次调用独立,不会改变之后调用的位置" },
      background: { type: "boolean", description: "可选:true 时作为后台进程启动(dev server 等长驻命令必须)" },
    },
    required: ["summary", "command"],
    additionalProperties: false,
  },
};

export const bash = async ({ command, summary, background, cwd: requestedCwd }, ctx) => {
  const cmd = String(command || "").trim();
  if (!cmd) return "error: command 不能为空";

  const cwd = executionDirectory(requestedCwd || ctx.cwd);

  // 显式 background,或看起来就是长驻命令(模型常忘) → 进程注册表,立即返回
  if (background || looksLongRunning(cmd)) {
    const proc = startProcess({ command: cmd, cwd, reason: summary || "" });
    await wait(1200);
    return formatProcess(
      getProcess(proc.id),
      background ? "started background process" : "detected long-running command; started background process",
    );
  }

  return new Promise((resolve) => {
    const child = spawn(resolveShell(), ["-lc", cmd], {
      cwd,
      env: process.env,
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const append = (current, chunk) => (current + chunk).slice(-RAW_MAX);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout = append(stdout, chunk); });
    child.stderr.on("data", (chunk) => { stderr = append(stderr, chunk); });

    const stop = () => {
      if (child.exitCode !== null) return;
      try {
        if (process.platform !== "win32") process.kill(-child.pid, "SIGTERM");
        else child.kill("SIGTERM");
      } catch { child.kill("SIGTERM"); }
    };
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; stop(); }, TIMEOUT_MS);
    const onAbort = () => stop();
    ctx.signal?.addEventListener("abort", onAbort, { once: true });

    const finish = (text) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      ctx.signal?.removeEventListener("abort", onAbort);
      ctx.emit?.({ type: "tree_changed", reason: "bash" }); // 可能建/改了文件 → 刷新树
      resolve(text);
    };

    child.on("error", (error) => finish(`error: ${error.message}`));
    child.on("close", (code, signalName) => {
      if (ctx.signal?.aborted) { finish("aborted"); return; }
      if (timedOut) {
        finish(`exit code ${code ?? 1}\ncommand exceeded ${Math.round(TIMEOUT_MS / 1000)}s and was stopped. Use background:true for dev servers or other long-running commands.\n${stderr}`);
        return;
      }
      const body = stdout || stderr || "(no output)";
      finish(code ? `exit code ${code}${signalName ? ` (${signalName})` : ""}\n${stderr || stdout || ""}` : body);
    });
  });
};

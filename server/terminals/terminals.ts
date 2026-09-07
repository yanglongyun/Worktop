// 交互式终端会话,按 ws 连接分组:连接断了,它开的终端全部收尾。
import { existsSync } from "fs";
import * as pty from "node-pty";
import { terminalDirectory } from "../agent/paths.js";

type Session = { id: string; term: pty.IPty; cwd: string };
/** ws 连接:终端会话挂在连接对象上,连接消失即随之回收。 */
type Client = { terminals?: Map<string, Session> };
type SendJson = (message: Record<string, unknown>) => void;

const SHELL_CANDIDATES = process.platform === "win32"
  ? [process.env.COMSPEC, "powershell.exe", "cmd.exe"]
  : [process.env.SHELL, "/bin/zsh", "/bin/bash", "/bin/sh"];

const resolveShell = () => SHELL_CANDIDATES.find((s) => s && existsSync(s)) || "/bin/sh";

const publicCwd = (cwd: string) => String(cwd || "").replace(process.env.HOME || "", "~");

const ensureTerminalMap = (client: Client) => {
  if (!client.terminals) client.terminals = new Map<string, Session>();
  return client.terminals;
};

const writeOutput = (sendJson: SendJson, terminalId: string, data: string) => {
  if (!data) return;
  sendJson({ type: "terminal_output", terminalId, data: String(data) });
};

const stopTerminal = (client: Client, terminalId: string, sendJson?: SendJson) => {
  const sessions = ensureTerminalMap(client);
  const id = String(terminalId || "");
  const session = sessions.get(id);
  if (!session) return;
  sessions.delete(id);
  try { session.term.write("exit\r"); } catch { /* 已经死了 */ }
  setTimeout(() => {
    try { session.term.kill(); } catch { /* 已经死了 */ }
  }, 300);
  sendJson?.({ type: "terminal_exit", terminalId: id, code: null, signal: "stopped" });
};

const stopAllTerminals = (client: Client, sendJson?: SendJson) => {
  const sessions = ensureTerminalMap(client);
  for (const id of Array.from(sessions.keys())) stopTerminal(client, id, sendJson);
};

const startTerminal = (client: Client, payload: any, sendJson: SendJson) => {
  const sessions = ensureTerminalMap(client);
  const terminalId = String(payload.terminalId || "").trim();
  if (!terminalId) {
    sendJson({ type: "terminal_error", error: "missing terminalId" });
    return;
  }
  if (sessions.has(terminalId)) stopTerminal(client, terminalId, sendJson);

  let cwd: string;
  try {
    cwd = terminalDirectory(payload.cwd || "");
  } catch (error) {
    sendJson({ type: "terminal_error", terminalId, error: (error as Error).message });
    return;
  }

  const shell = resolveShell();
  let term: pty.IPty;
  try {
    term = pty.spawn(shell, process.platform === "win32" ? [] : ["-i"], {
      name: "xterm-256color",
      cols: Math.max(20, Number(payload.cols) || 100),
      rows: Math.max(5, Number(payload.rows) || 30),
      cwd,
      env: {
        ...process.env,
        TERM: "xterm-256color",
        COLORTERM: "truecolor",
        CLICOLOR: "1",
        FORCE_COLOR: "1",
      },
    });
  } catch (error) {
    sendJson({ type: "terminal_error", terminalId, error: (error as Error).message || String(error) });
    return;
  }

  const session: Session = { id: terminalId, term, cwd };
  term.onData((data: string) => writeOutput(sendJson, terminalId, data));
  term.onExit(({ exitCode, signal }: { exitCode: number; signal?: number }) => {
    if (sessions.get(terminalId) !== session) return;
    sessions.delete(terminalId);
    sendJson({ type: "terminal_exit", terminalId, code: exitCode, signal });
  });
  sessions.set(terminalId, session);
  sendJson({ type: "terminal_started", terminalId, cwd, title: payload.title || publicCwd(cwd) });
};

const writeTerminal = (client: Client, payload: any) => {
  const sessions = ensureTerminalMap(client);
  const terminalId = String(payload.terminalId || "");
  const session = sessions.get(terminalId);
  if (!session) return;
  session.term.write(String(payload.data || ""));
};

const resizeTerminal = (client: Client, payload: any) => {
  const sessions = ensureTerminalMap(client);
  const terminalId = String(payload.terminalId || "");
  const session = sessions.get(terminalId);
  if (!session) return;
  const cols = Math.max(20, Number(payload.cols) || 0);
  const rows = Math.max(5, Number(payload.rows) || 0);
  if (!cols || !rows) return;
  try { session.term.resize(cols, rows); } catch { /* 尺寸非法或已退出 */ }
};

export { startTerminal, stopTerminal, stopAllTerminals, writeTerminal, resizeTerminal };

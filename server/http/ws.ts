// @ts-nocheck
// WebSocket:唯一的双向通道。
//   - send:落库用户消息 → 立即返回;轮子在 runs 层后台转,事件广播、按 chatId 认领。
//     从前 send 在这里 await 整轮 —— 新模型下运行不绑在任何一次收发上。
//   - stop:停任意 chatId。
//   - terminal_*:终端多路复用(必须双向,ws 因此是通道的形态)。
import WebSocket, { WebSocketServer } from "ws";
import { setBroadcaster } from "../bus.js";
import { EVENTS } from "../shared/events.js";
import { runChat, stopChat } from "../chats/turn.js";
import { appendItem } from "../chats/messages.js";
import { touchChat } from "../chats/store.js";
import { emit } from "../bus.js";
import { resizeTerminal, startTerminal, stopAllTerminals, stopTerminal, writeTerminal } from "../terminals/terminals.js";
import { registerHost, registerTab, resolveBrowserResult, unregisterClient, unregisterTab, updateTab } from "../browser/host.js";
import { normalizeMany as normalizeAttachments } from "../files/attachments.js";
import { isTrustedHost, isTrustedOrigin } from "./origin.js";

const clients = new Set();

const sendJson = (ws, payload) => {
  if (ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify(payload));
};

const broadcastAll = (payload) => {
  for (const client of clients) sendJson(client.ws, payload);
};

setBroadcaster(broadcastAll);

const handleConnection = (ws) => {
  const client = { ws, terminals: new Map() };
  clients.add(client);
  sendJson(ws, { type: "connected", ok: true });
  const sendToClient = (payload) => sendJson(ws, payload);

  ws.on("message", async (raw) => {
    let payload;
    try { payload = JSON.parse(String(raw)); }
    catch { sendJson(ws, { type: "error", error: "bad json" }); return; }

    const type = String(payload.type || "");
    const chatId = String(payload.chatId || "");

    if (type === "stop") {
      stopChat(chatId);
      return;
    }
    if (type === "terminal_start") { startTerminal(client, payload, sendToClient); return; }
    if (type === "terminal_input") { writeTerminal(client, payload); return; }
    if (type === "terminal_resize") { resizeTerminal(client, payload); return; }
    if (type === "terminal_stop") { stopTerminal(client, payload.terminalId, sendToClient); return; }

    // ── 浏览器宿主(browser 工具的执行端:Electron 壳里的 UI)──
    if (type === "web_host_hello") { registerHost(client); return; }
    if (type === "web_tab_register") { registerTab(client, payload); return; }
    if (type === "web_tab_update") { updateTab(payload); return; }
    if (type === "web_tab_unregister") { unregisterTab(payload); return; }
    if (type === "browser_response") { resolveBrowserResult(payload); return; }

    if (type === "send") {
      if (!chatId) { sendJson(ws, { type: "error", error: "missing chatId" }); return; }
      const prompt = String(payload.prompt || "").trim();
      let attachments = [];
      try { attachments = normalizeAttachments(payload.attachments); }
      catch (error) { sendJson(ws, { type: "error", error: String(error?.message || error) }); return; }
      if (prompt || attachments.length) {
        const item = { role: "user", content: prompt };
        if (attachments.length) item.attachments = attachments; // 元数据进 item;请求期由附件层展开/剥除
        const row = appendItem(chatId, item, { meta: { kind: "message" } });
        touchChat(chatId); // 浮到最近组顶部
        emit({ type: EVENTS.INPUT, chatId, row });
      }
      // 立即返回;终局事件(done/aborted/error)由 runs 层广播。
      // 这里只兜运行前的失败(正在运行/没配模型),它们发生在任何广播之前。
      runChat(chatId).catch((error) => {
        if (error?.name === "AbortError") return;
        if (/already running/i.test(error?.message || "")) return; // 邮箱已收到消息,跑完这轮自然会带上
        emit({ type: EVENTS.ERROR, chatId, message: String(error?.message || error) });
      });
      return;
    }

    sendJson(ws, { type: "error", error: `unknown: ${type}` });
  });

  ws.on("close", () => {
    stopAllTerminals(client);
    unregisterClient(client); // 窗口没了,它注册的网页标签一并出册
    clients.delete(client);
  });
};

const attachWs = (server, port) => {
  const wss = new WebSocketServer({ noServer: true });
  wss.on("connection", handleConnection);
  server.on("upgrade", (req, socket, head) => {
    const url = new URL(req.url || "/", "http://127.0.0.1");
    if (url.pathname !== "/api/ws") { socket.destroy(); return; }
    // ws 是执行 bash / 读写磁盘的通道 —— 恶意网页能 new WebSocket 到本机端口,
    // 必须校验 Origin,只放行应用自身(浏览器发起的跨源升级一定带 Origin)。
    if (!isTrustedHost(req.headers.host) || !isTrustedOrigin(req.headers.origin, port)) {
      socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
  });
};

export { attachWs };

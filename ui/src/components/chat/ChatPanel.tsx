import { type ApprovalCard as Card, type Chat, chatsApi } from "../../api/chats";
import { type Attachment, filesApi } from "../../api/files";
import { settingsApi } from "../../api/settings";
// 对话面板:一个对话的邮箱 + 输入器。
// 行数组是可变结构(流式原地改行,tick 触发重渲染),事件按 chatId 认领 ——
// 同一面板体系下,几个对话各开各的标签互不干扰,切走的运行在服务端继续转。
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowRight, FileText, Folder, LayoutGrid, Paperclip, PenLine, Plug, Send, Square, X } from "lucide-react";
import { ApprovalCard } from "./ApprovalCard";
import { RulesControl } from "./RulesControl";
import { ModelSetupDialog } from "./ModelSetupDialog";
import type { ChatStartTab } from "../workspace/types";
import { dialog } from "../ui";
import { EVENTS } from "../../../../server/shared/events";
import { MessageStream } from "./MessageStream";
import { setupStream } from "./stream";
import { mkKey, renderRows, type Row } from "./thread";

export function ChatPanel({
  node,
  onSelect: _onSelect,
  socket,
  onOpenNav: _onOpenNav,
  onOpenSettings,
  onCreated,
}: {
  node: Chat | ChatStartTab;
  onSelect: (n: Chat) => void;
  socket: { send: (m: any) => void; on: (t: string, fn: (p: any) => void) => () => void };
  onOpenNav?: () => void;
  onOpenSettings?: () => void;
  onCreated?: (node: Chat, prompt: string, attachments: Attachment[]) => void;
}) {
  const isStart = node.kind === "chat-start";
  const creatingRef = useRef(false);
  const autoSentRef = useRef(false);
  const [creating, setCreating] = useState(false);

  // 可变行数组 + tick:流式增量不换数组,只改行再摇铃
  const rowsRef = useRef<Row[]>([]);
  const [tick, setTick] = useState(0);
  const [busy, setBusy] = useState((node.kind === "chat" && node.status === "running"));
  const [viewSeq, setViewSeq] = useState(0);
  const [prompt, setPrompt] = useState("");
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [modelName, setModelName] = useState("");
  const [modelSetupOpen, setModelSetupOpen] = useState(false);
  const [messagesLoaded, setMessagesLoaded] = useState(isStart);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const composingRef = useRef(false);

  const bump = useCallback(() => setTick((n) => n + 1), []);
  const pushRow = useCallback((row: Row) => { rowsRef.current.push(row); return row; }, []);

  // 配置保存后同步所有已打开的对话,无需切走再回来。
  useEffect(() => {
    let active = true;
    const reload = () => { void settingsApi.getSettings()
      .then(({ settings: s }) => {
        if (!active) return;
        setConfigured(!!(s.model.trim() && s.apiUrl.trim()));
        setModelName(s.model);
      }).catch(() => {}); };
    reload();
    window.addEventListener("worktop:settings-saved", reload);
    return () => { active = false; window.removeEventListener("worktop:settings-saved", reload); };
  }, [node.id]);

  const refresh = useCallback(async () => {
    if (isStart) return;
    const result = await chatsApi.listMessages(node.id).catch(() => null);
    if (!result) return;
    const next = renderRows(result.rows || []);
    // 同位置同类的行复用旧 key:React 原地复用 DOM,不整屏重挂
    const prev = rowsRef.current;
    for (let i = 0; i < next.length && i < prev.length; i++) {
      if (next[i].kind === prev[i].kind) next[i].key = prev[i].key;
    }
    rowsRef.current = next;
    setMessagesLoaded(true);
    bump();
  }, [node.id, bump]);

  // 草稿按对话落 localStorage,切走再回来不丢
  const draftKey = `worktop.draft:${node.id}`;
  useEffect(() => {
    const initial = node.kind === "chat-start" ? node.initialPrompt || "" : "";
    try { setPrompt(localStorage.getItem(draftKey) ?? initial); } catch { setPrompt(initial); }
  }, [node.id]);
  const persistDraft = (value: string) => {
    try {
      if (value) localStorage.setItem(draftKey, value);
      else localStorage.removeItem(draftKey);
    } catch { /* 私隐模式存不了就算了 */ }
  };

  // 流 reducer 跟着 node.id 走
  const streamRef = useRef<ReturnType<typeof setupStream> | null>(null);
  useEffect(() => {
    rowsRef.current = [];
    setMessagesLoaded(isStart);
    if (isStart) { setBusy(false); bump(); return; }
    setBusy((node.kind === "chat" && node.status === "running"));
    bump();
    streamRef.current = setupStream({
      chatId: node.id,
      getRows: () => rowsRef.current,
      pushRow,
      setBusy,
      refresh: () => { void refresh(); },
      bump,
    });
    void refresh().then(() => setViewSeq((n) => n + 1));
    // busy 以服务端为准对一次账(node.status 可能是十秒前的)
    void chatsApi.listRuns().then((r) => setBusy((r.ids || []).includes(node.id))).catch(() => {});
    chatsApi.markRead(node.id).catch(() => {});
    return () => { streamRef.current = null; };
  }, [node.id]);

  // 订阅对话事件(广播全量,reducer 按 chatId 认领)
  useEffect(() => {
    if (isStart) return;
    const names = Object.values(EVENTS) as string[];
    const offs = names.map((name) => socket.on(name, (payload: any) => {
      streamRef.current?.onEvent(payload);
      if (name === EVENTS.INPUT && payload.chatId === node.id) chatsApi.markRead(node.id).catch(() => {});
    }));
    return () => { offs.forEach((off) => off()); };
  }, [node.id, socket]);

  // 自动撑高
  useEffect(() => {
    const element = inputRef.current;
    if (!element) return;
    element.style.height = "auto";
    element.style.height = Math.min(element.scrollHeight, 240) + "px";
  }, [prompt, configured]);

  // 附件上传:选择 / 拖拽 / 粘贴共用一条路 —— base64 交给 /api/files/upload,只留元数据
  const upload = async (files: FileList | File[]) => {
    setUploading(true);
    try {
      const next: Attachment[] = [];
      for (const file of Array.from(files)) {
        const dataBase64 = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onerror = () => reject(reader.error);
          reader.onload = () => resolve(String(reader.result).split(",")[1] || "");
          reader.readAsDataURL(file);
        });
        const result = await filesApi.uploadFile({ name: file.name || "粘贴的图片.png", mimeType: file.type, dataBase64 });
        next.push(result.attachment);
      }
      setAttachments((current) => [...current, ...next].slice(0, 10));
    } catch (error: any) {
      void dialog.alert(error?.message || "文件上传失败");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const send = async () => {
    const text = prompt.trim();
    if ((!text && !attachments.length) || busy || uploading || creatingRef.current) return;
    if (configured === null) return;
    if (!configured) { setModelSetupOpen(true); return; }
    const files = attachments;
    if (isStart) {
      if (!onCreated) return;
      creatingRef.current = true;
      setCreating(true);
      try {
        const result = await chatsApi.createChat({ title: "" });
        persistDraft("");
        onCreated(result.item, text, files);
      } catch (error) {
        void dialog.alert(error instanceof Error ? error.message : "新建对话失败，请重试。");
        creatingRef.current = false;
        setCreating(false);
      }
      return;
    }
    setPrompt("");
    setAttachments([]);
    persistDraft("");
    // 乐观入画;服务端广播回来的那份由 reducer 跳过一次
    pushRow({ key: mkKey("u"), kind: "user", source: "user", content: text, attachments: files, at: Date.now() });
    streamRef.current?.armLocalEcho();
    setBusy(true);
    setViewSeq((n) => n + 1);
    bump();
    socket.send({ type: "send", chatId: node.id, prompt: text, attachments: files });
  };

  // 新标签页中按回车已表达发送意图;模型未配置时保留草稿,配置完成后再发送。
  useEffect(() => {
    if (node.kind !== "chat-start" || !node.sendOnOpen || autoSentRef.current || !configured || !prompt.trim()) return;
    autoSentRef.current = true;
    void send();
  }, [configured, prompt]);

  // ── 审批:卡片跟着这段对话走 ──────────────────────────────────────────
  // 刷新页面要把还悬着的卡捞回来,否则用户永远等不到那张卡(轮次还挂在那儿等表态)
  const [approvals, setApprovals] = useState<Card[]>([]);
  useEffect(() => {
    setApprovals([]);
    if (isStart) return;
    void chatsApi.listApprovals(node.id).then(setApprovals).catch(() => {});
  }, [node.id]);
  useEffect(() => socket.on("approval_ask", (p: any) => {
    if (String(p?.chatId) !== node.id) return;
    setApprovals((list) => (list.some((c) => c.id === p.id) ? list : [...list, p as Card]));
  }), [socket, node.id]);
  useEffect(() => socket.on("approval_done", (p: any) => {
    setApprovals((list) => list.filter((c) => c.id !== p.id));
  }), [socket]);
  const dismiss = (id: string) => setApprovals((list) => list.filter((c) => c.id !== id));

  const [rulesOn, setRulesOn] = useState(true);
  useEffect(() => { void settingsApi.getSettings().then((r: any) => setRulesOn((r.settings?.rulesEnabled || "on") !== "off")).catch(() => {}); }, []);
  const changeRules = (next: boolean) => {
    setRulesOn(next);
    // 只改这一项:先取回整份再合并,免得把别的设置抹成默认值
    void settingsApi.getSettings()
      .then((r: any) => settingsApi.saveSettings({ ...(r.settings || {}), rulesEnabled: next ? "on" : "off" }))
      .catch(() => {});
  };

  const empty = messagesLoaded && rowsRef.current.length === 0 && !busy && approvals.length === 0;
  const chooseSuggestion = (value: string) => {
    setPrompt(value);
    persistDraft(value);
    inputRef.current?.focus();
  };

  return (
    <div className="flex-1 min-h-0 flex flex-col min-w-0 bg-bg">
      {!empty && <MessageStream rows={rowsRef.current} busy={busy} tick={tick} viewSeq={viewSeq} />}

      {/* 审批卡:贴着消息流的末尾,和输入区之间 —— 它属于这一轮,不是浮层 */}
      {approvals.length > 0 && (
        <div className="shrink-0 max-h-[45vh] overflow-y-auto px-4 md:px-8 pb-3 flex flex-col items-center gap-2">
          {approvals.map((card) => (
            <ApprovalCard key={card.id} card={card} onDone={dismiss} />
          ))}
        </div>
      )}

      {/* 同一个输入器:首条消息前居中,开始对话后回到底部,保留草稿与附件状态。 */}
      <div className={empty ? "flex-1 min-h-0 overflow-y-auto flex flex-col" : "shrink-0"}>
      <div className={`mx-auto w-full max-w-3xl px-4 md:px-8 ${empty ? "my-auto py-10" : "pt-2 pb-4"}`}>
        {empty && configured !== null && (
          <div className={`mb-7 ${configured ? "text-center" : "mx-auto max-w-md text-center"}`}>
            {!configured && <div className="mx-auto mb-5 flex h-12 w-12 items-center justify-center rounded-2xl border border-accent/15 bg-accent/5 text-accent"><Plug size={23} strokeWidth={1.6} /></div>}
            <h1 className="text-[26px] md:text-[30px] font-semibold tracking-tight text-text">
              {configured ? "今天想做什么？" : "连接模型，开始工作"}
            </h1>
            <p className="mt-3 text-[13.5px] leading-7 text-text-dim">
              {configured ? "从一个想法、一份文件，或一件想完成的事开始。" : "配置模型后，就可以让 AI 处理文件、编写内容和执行任务。"}
            </p>
            {!configured && <>
              <button onClick={() => setModelSetupOpen(true)} className="mx-auto mt-7 inline-flex items-center gap-2 rounded-lg bg-accent px-5 py-2.5 text-[13px] font-medium text-white hover:opacity-90">
                配置模型<ArrowRight size={15} />
              </button>
              <p className="mt-4 text-[11.5px] text-text-faint">准备好接口地址、密钥和模型名称即可</p>
            </>}
          </div>
        )}
        {configured === null && <div className="py-4 text-center text-[12px] text-text-faint">正在读取模型配置…</div>}
        {configured === false && !empty && <div className="mb-3 flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2 text-[12px] text-text-dim">
          <span>配置模型后，继续这段对话。</span>
          <button onClick={() => setModelSetupOpen(true)} className="shrink-0 text-accent">配置模型 →</button>
        </div>}
        <div hidden={configured !== true && !busy}>
        <div
          className={`flex flex-col rounded-2xl border border-border bg-surface cursor-text focus-within:border-accent transition-colors ${empty ? "shadow-[0_4px_24px_rgba(0,0,0,0.035)]" : ""}`}
          onClick={(e) => { if (e.target === e.currentTarget) inputRef.current?.focus(); }}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => { e.preventDefault(); if (e.dataTransfer.files?.length) void upload(e.dataTransfer.files); }}
        >
          <input ref={fileRef} hidden type="file" multiple onChange={(e) => { if (e.target.files?.length) void upload(e.target.files); }} />

          {/* 附件托盘:发送前可见可移除 */}
          {(attachments.length > 0 || uploading) && (
            <div className="flex flex-wrap items-center gap-1.5 px-3 pt-2.5">
              {attachments.map((file) => (
                <span key={file.id} className="inline-flex items-center gap-1.5 pl-1.5 pr-1 py-1 rounded-md bg-bg-panel text-[12px] text-text-dim max-w-[220px]">
                  {file.mimeType.startsWith("image/")
                    ? <img src={file.url} alt="" className="w-5 h-5 rounded object-cover shrink-0" />
                    : <FileText size={13} className="shrink-0 text-accent" />}
                  <span className="truncate">{file.name}</span>
                  <button
                    title="移除"
                    onClick={() => setAttachments((items) => items.filter((item) => item.id !== file.id))}
                    className="shrink-0 w-4 h-4 rounded flex items-center justify-center hover:bg-bg-hover hover:text-text"
                  >
                    <X size={11} />
                  </button>
                </span>
              ))}
              {uploading && <span className="text-[12px] text-text-faint">上传中…</span>}
            </div>
          )}

          {/* 输入框独占一行、吃满宽度 —— 工具按钮不再从左右两侧挤占正文 */}
          <textarea
            ref={inputRef}
            rows={2}
            className="w-full min-h-[62px] max-h-60 bg-transparent px-3.5 pt-3 text-[15px] text-text placeholder:text-text-faint outline-none resize-none leading-relaxed overflow-y-auto"
            // 跑着的时候输入框是禁用的,再摆一句「发送消息…」等于叫人做一件做不了的事
            placeholder={busy ? "正在运行中…" : empty ? "描述你想完成的事，或添加文件…" : "发送消息…"}
            aria-label="消息"
            value={prompt}
            onChange={(e) => { setPrompt(e.target.value); persistDraft(e.target.value); }}
            onCompositionStart={() => { composingRef.current = true; }}
            onCompositionEnd={() => { composingRef.current = false; }}
            onPaste={(e) => {
              // 粘贴截图/图片:直接走上传,不进文本
              if (e.clipboardData?.files?.length) { e.preventDefault(); void upload(e.clipboardData.files); }
            }}
            onKeyDown={(e) => {
              // 中文/日文/韩文 IME 组词期间(选词按 Enter)不触发 send
              if (composingRef.current || (e.nativeEvent as any).isComposing || e.keyCode === 229) return;
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            disabled={busy || creating}
          />

          {/* 工具行:左边附件,右边发送/停止。独立一行,不与正文抢横向空间 */}
          <div className="flex items-center gap-2 px-2 pb-2">
            <button
              title="添加图片或文件(也可拖拽 / 粘贴)"
              onClick={() => fileRef.current?.click()}
              disabled={busy || creating || uploading}
              className="w-8 h-8 rounded-md flex items-center justify-center text-text-faint hover:text-text hover:bg-bg-hover disabled:opacity-40 transition-colors shrink-0"
            >
              <Paperclip size={16} />
            </button>
            <RulesControl on={rulesOn} onChange={changeRules} quiet={empty} />
            <div className="flex-1" />
            {modelName && <button onClick={() => onOpenSettings?.()} title={`当前模型：${modelName}`} className="max-w-[40%] truncate px-1 text-[11px] text-text-faint hover:text-text-dim">{modelName}</button>}
            {busy ? (
              <button
                title="停止"
                onClick={() => socket.send({ type: "stop", chatId: node.id })}
                className="w-8 h-8 rounded-md flex items-center justify-center text-text-faint hover:text-danger hover:bg-bg-hover transition-colors shrink-0"
              >
                <Square size={14} />
              </button>
            ) : (
              <button
                title={creating ? "正在创建对话…" : "发送"}
                onClick={send}
                disabled={(!prompt.trim() && !attachments.length) || uploading || creating}
                className="w-8 h-8 rounded-md flex items-center justify-center bg-accent text-white hover:opacity-85 disabled:opacity-30 disabled:cursor-not-allowed transition-all shrink-0"
              >
                <Send size={14} />
              </button>
            )}
          </div>
        </div>
        {empty && <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
          {[
            { label: "整理文件", icon: Folder, prompt: "帮我整理文件。先查看我指定的目录，提出分类建议，确认后再移动。" },
            { label: "写点东西", icon: PenLine, prompt: "帮我写一份内容。先和我确认主题、用途和读者，再一起完成初稿。" },
            { label: "做个小工具", icon: LayoutGrid, prompt: "我想做一个日常使用的小工具。先和我确认需求，再做一个可以使用的版本。" },
          ].map((suggestion) => <button key={suggestion.label} onClick={() => chooseSuggestion(suggestion.prompt)}
            className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-[12px] text-text-dim hover:border-border-strong hover:bg-bg-hover">
            <suggestion.icon size={13} className="text-text-faint" />{suggestion.label}
          </button>)}
        </div>}

        </div>
      </div>
      </div>
      {modelSetupOpen && <ModelSetupDialog onClose={() => setModelSetupOpen(false)} onSaved={(settings) => {
        setConfigured(!!(settings.model.trim() && settings.apiUrl.trim()));
        setModelName(settings.model);
        setModelSetupOpen(false);
        requestAnimationFrame(() => inputRef.current?.focus());
      }} />}
    </div>
  );
}

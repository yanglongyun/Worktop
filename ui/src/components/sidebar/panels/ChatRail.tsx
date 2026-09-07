import { EVENTS } from "../../../../../server/shared/events";
import { type Chat, chatsApi } from "../../../api/chats";
// 会话列表:对话不再长在文件树里,这里是它们的家。
// 置顶 / 最近两组;行上呼吸点 = 正在运行,绿点 = 未读;悬停 ⋯ 出操作。
import { useCallback, useEffect, useState } from "react";
import { ContextMenu, dialog, type MenuItem } from "../../ui";
import { MoreVertical, Pencil, Pin, PinOff, Plus, SlidersHorizontal, Trash2 } from "lucide-react";
import { relativeTime, toggleChatRowField, useChatRowFields, type ChatRowFields } from "../../../lib/chatRows";
import { PanelEmptyState } from "./PanelEmptyState";
import { PanelCreateAction } from "./PanelCreateAction";

type Socket = { send: (m: any) => void; on: (t: string, fn: (p: any) => void) => () => void };

export function ChatRail({
  selectedId,
  onSelect,
  refreshKey,
  socket,
}: {
  selectedId: string;
  onSelect: (n: Chat) => void;
  refreshKey: number;
  socket: Socket;
}) {
  const [agents, setAgents] = useState<Chat[]>([]);
  const [running, setRunning] = useState<Set<string>>(new Set());
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);
  const fields = useChatRowFields();
  // 显示项菜单只存**位置**:菜单项每次渲染现算 —— 勾完不关菜单,对勾要立刻跟着变,
  // 存成 items 快照的话勾了也不动(菜单是打开那一刻算的)
  const [fieldsMenuAt, setFieldsMenuAt] = useState<{ x: number; y: number } | null>(null);
  const fieldsMenuItems: MenuItem[] = ([
    ["last", "最后一条消息"],
    ["time", "时间"],
  ] as [keyof ChatRowFields, string][]).map(([key, label]) => ({
    label, checked: fields[key], keepOpen: true, onClick: () => toggleChatRowField(key),
  }));

  const load = useCallback(async () => {
    const result = await chatsApi.listChats().catch(() => null);
    if (result) setAgents(result.chats);
  }, []);
  useEffect(() => { load(); }, [load, refreshKey]);

  // 呼吸点:事件即亮即灭,10 秒轮询兜底对账
  useEffect(() => {
    const sync = () => chatsApi.listRuns().then((r) => setRunning(new Set(r.ids || []))).catch(() => {});
    sync();
    const timer = setInterval(sync, 10_000);
    const offs = [
      socket.on(EVENTS.START, (p: any) => setRunning((s) => new Set(s).add(String(p.chatId)))),
      ...[EVENTS.DONE, EVENTS.ABORTED, EVENTS.ERROR].map((t) =>
        socket.on(t, (p: any) => setRunning((s) => { const n = new Set(s); n.delete(String(p.chatId)); return n; })),
      ),
    ];
    return () => { clearInterval(timer); offs.forEach((f) => f()); };
  }, [socket]);

  // 起始页不落库,首条消息发送后才会出现在会话列表里。
  const createNow = () => {
    window.dispatchEvent(new Event("worktop:new-chat"));
  };

  const commitRename = async () => {
    const id = renamingId;
    const title = renameDraft.trim();
    setRenamingId(null);
    if (!id || !title) return;
    await chatsApi.updateChat(id, { title });
    load();
  };

  const onContext = (e: React.MouseEvent, agent: Chat) => {
    e.preventDefault();
    e.stopPropagation();
    setMenu({
      x: e.clientX, y: e.clientY,
      items: [
        { label: agent.pinned ? "取消置顶" : "置顶",
          icon: agent.pinned ? <PinOff size={13} /> : <Pin size={13} className="text-accent" />,
          onClick: async () => { await chatsApi.updateChat(agent.id, { pinned: !agent.pinned }); load(); } },
        { label: "重命名", icon: <Pencil size={13} />, onClick: () => { setRenamingId(agent.id); setRenameDraft(agent.title); } },
        "divider",
        { label: "删除", icon: <Trash2 size={13} />, danger: true,
          onClick: async () => {
            if (!(await dialog.confirm(`删除对话「${agent.title}」?\n全部消息记录会一并删除。`, { danger: true, confirmText: "删除" }))) return;
            await chatsApi.deleteChat(agent.id);
            load();
          } },
      ],
    });
  };

  const row = (agent: Chat) => {
    const isSelected = selectedId === agent.id;
    const live = running.has(agent.id);
    const isRenaming = renamingId === agent.id;
    return (
      <div
        key={agent.id}
        onClick={() => { if (!isRenaming) onSelect(agent); }}
        onContextMenu={(e) => onContext(e, agent)}
        className={[
          "group flex items-start gap-1.5 py-[4px] pl-3 pr-2 cursor-pointer select-none text-text",
          isSelected && !isRenaming ? "bg-bg-inset" : "hover:bg-bg-hover",
        ].join(" ")}
      >
        {isRenaming ? (
          <input
            autoFocus
            value={renameDraft}
            onChange={(e) => setRenameDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitRename();
              if (e.key === "Escape") setRenamingId(null);
            }}
            onBlur={commitRename}
            onClick={(e) => e.stopPropagation()}
            className="flex-1 min-w-0 bg-surface border border-accent rounded px-1 -mx-1 py-px text-[14px] text-text outline-none"
          />
        ) : (
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="flex-1 min-w-0 truncate text-[14.5px]">{agent.title}</span>
              {fields.time && (
                <span className="shrink-0 text-[11px] tabular-nums text-text-faint">
                  {relativeTime(agent.last?.at || agent.updated_at)}
                </span>
              )}
            </div>
            {fields.last && agent.last && (
              <div className="mt-px truncate text-[11.5px] text-text-faint">
                <span className="text-text-dim">{agent.last.role === "user" ? "我" : "助手"}:</span>{" "}
                {agent.last.text}
              </div>
            )}
          </div>
        )}
        {live
          ? <span className="w-1.5 h-1.5 rounded-full shrink-0 mt-[6px] bg-accent animate-pulse" title="正在运行" />
          : agent.unread
            ? <span className="w-1.5 h-1.5 rounded-full shrink-0 mt-[6px] bg-success" title="未读" />
            : null}
        <button
          onClick={(e) => { e.stopPropagation(); onContext(e, agent); }}
          className="shrink-0 self-center w-5 h-5 rounded flex items-center justify-center text-text-faint hover:text-text hover:bg-bg-inset opacity-0 group-hover:opacity-100 max-md:opacity-60"
          title="更多操作"
        >
          <MoreVertical size={14} />
        </button>
      </div>
    );
  };

  const pinned = agents.filter((a) => a.pinned);
  const recent = agents.filter((a) => !a.pinned);

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      {/* 顶部置顶功能区:与网站面板的工具行同一口径 —— 一条分割线把它和列表分开 */}
      {agents.length > 0 && (
        <PanelCreateAction label="新建对话" onClick={() => void createNow()} />
      )}
      <div className="flex-1 min-h-0 overflow-y-auto">
      {pinned.length > 0 && (<>
        <div className="px-3 pt-2 pb-1 text-[11px] font-medium text-text-faint select-none">置顶</div>
        {pinned.map(row)}
      </>)}
      {recent.length > 0 && (<>
        <div className="flex items-center gap-1 pl-3 pr-2 pt-2 pb-1 text-[11px] font-medium text-text-faint select-none">
          <span className="flex-1">最近</span>
          {/* 显示项:控制点就在这一行右端,不占额外空间、也不必进设置页 */}
          <button
            onClick={(e) => {
              e.stopPropagation();
              const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
              setFieldsMenuAt((open) => (open ? null : { x: r.right - 176, y: r.bottom + 4 }));
            }}
            title="每行显示哪些信息"
            className="shrink-0 w-5 h-5 rounded flex items-center justify-center hover:text-text hover:bg-bg-hover transition-colors"
          >
            <SlidersHorizontal size={12} />
          </button>
        </div>
        {recent.map(row)}
      </>)}

      {agents.length === 0 && (
        <PanelEmptyState
          title="还没有对话"
          description="新建一个对话,让 AI 帮你读写文件、执行任务。"
          action="新建对话"
          icon={<Plus size={13} />}
          onAction={() => void createNow()}
        />
      )}
      </div>

      {menu && <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />}
      {fieldsMenuAt && (
        <ContextMenu x={fieldsMenuAt.x} y={fieldsMenuAt.y} items={fieldsMenuItems} onClose={() => setFieldsMenuAt(null)} />
      )}
    </div>
  );
}

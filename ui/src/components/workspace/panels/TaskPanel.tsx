import { EVENTS } from "../../../../../server/shared/events";
import { type TaskInfo, appsApi } from "../../../api/apps";
import { chatsApi } from "../../../api/chats";
// 任务详情(标签页):应用触发的一次 agent 轮次,摊开看指令、回复、报错。
import { useCallback, useEffect, useState } from "react";
import { Activity } from "lucide-react";
import { MessageStream } from "../../chat/MessageStream";
import { renderRows, type Row } from "../../chat/thread";
import type { TaskTab } from "../types";

type Socket = { send: (m: any) => void; on: (t: string, fn: (p: any) => void) => () => void };

const STATUS: Record<TaskInfo["status"], { label: string; cls: string }> = {
  running: { label: "进行中", cls: "text-accent bg-accent-soft" },
  done: { label: "已完成", cls: "text-success bg-success/10" },
  error: { label: "失败", cls: "text-danger bg-danger/10" },
  aborted: { label: "已中止", cls: "text-text-faint bg-bg-inset" },
};

export function TaskPanel({ tab, socket }: { tab: TaskTab; socket: Socket }) {
  const [task, setTask] = useState<TaskInfo | null | undefined>(undefined); // undefined = 读取中
  const [rows, setRows] = useState<Row[]>([]);
  const [tick, setTick] = useState(0);

  const load = useCallback(() => {
    void appsApi.listTasks(200)
      .then((list) => setTask(list.find((t) => t.id === tab.taskId) || null))
      .catch(() => setTask(null));
    // 过程与会话同规格,直接读 messages 回放
    void chatsApi.listMessages(tab.taskId)
      .then((r) => { setRows(renderRows(r.rows || [])); setTick((n) => n + 1); })
      .catch(() => {});
  }, [tab.taskId]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => socket.on("tasks_changed", load), [socket, load]);
  // 任务跑动时逐条落库,和会话同一个事件
  useEffect(() => socket.on(EVENTS.INPUT, (p: any) => { if (String(p?.chatId) === tab.taskId) load(); }), [socket, tab.taskId, load]);

  if (task === undefined) {
    return <div className="flex-1 flex items-center justify-center text-[13px] text-text-faint">读取中…</div>;
  }
  if (!task) {
    return <div className="flex-1 flex items-center justify-center text-[13px] text-text-faint">这条任务不在了</div>;
  }

  const meta = STATUS[task.status] || STATUS.done;
  return (
    <div className="flex-1 min-h-0 flex flex-col bg-bg">
      <div className="shrink-0 px-6 py-3.5 border-b border-border">
        <div className="flex items-center gap-2 text-[11.5px] text-text-faint">
          <Activity size={13} className="text-accent" />
          <span>{task.app_id}</span>
          <span className={`px-1.5 py-0.5 rounded ${meta.cls}`}>{meta.label}</span>
          <span>{task.created_at}</span>
        </div>
        <h1 className="mt-1 text-[16px] font-semibold text-text leading-snug">{task.title || task.prompt}</h1>
        {task.error && <div className="mt-1.5 text-[12px] text-danger">{task.error}</div>}
      </div>
      {/* 过程回放:与会话同一个渲染器 —— 思考、工具调用、工具结果、正文都在 */}
      <MessageStream rows={rows} busy={task.status === "running"} tick={tick} viewSeq={0} />
    </div>
  );
}

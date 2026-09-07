// 任务面板:应用替你干的活(应用调 /host/ai/agent 触发的 agent 轮次)。
// 与会话分开 —— 那是你自己在说话,这是应用在后台替你跑。
import { useCallback, useEffect, useState } from "react";
import { api, type TaskInfo } from "../../../api";

type Socket = { send: (m: any) => void; on: (t: string, fn: (p: any) => void) => () => void };

const STATUS: Record<TaskInfo["status"], { label: string; dot: string }> = {
  running: { label: "进行中", dot: "bg-accent animate-pulse" },
  done: { label: "已完成", dot: "bg-success" },
  error: { label: "失败", dot: "bg-danger" },
  aborted: { label: "已中止", dot: "bg-text-faint" },
};

/** "2026-09-01 13:20:11" → 相对时间。库里存的是本地时间字符串。 */
const ago = (at: string) => {
  const t = new Date(at.replace(" ", "T")).getTime();
  const ms = Date.now() - t;
  if (!Number.isFinite(ms)) return at;
  if (ms < 60_000) return "刚刚";
  if (ms < 3600_000) return `${Math.round(ms / 60_000)} 分钟前`;
  if (ms < 86400_000) return `${Math.round(ms / 3600_000)} 小时前`;
  return `${Math.round(ms / 86400_000)} 天前`;
};

export function TasksPanel({ socket, onOpenTask }: { socket: Socket; onOpenTask: (taskId: string, title: string) => void }) {
  const [tasks, setTasks] = useState<TaskInfo[] | null>(null);

  const load = useCallback(() => {
    void api.listTasks().then(setTasks).catch(() => setTasks([]));
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => socket.on("tasks_changed", load), [socket, load]);

  if (!tasks) return <div className="flex-1 px-3 py-6 text-center text-[12.5px] text-text-faint">读取中…</div>;

  if (!tasks.length) {
    return (
      <div className="flex-1 px-5 py-10 text-center">
        <div className="text-[13px] text-text-dim">还没有任务</div>
        <div className="mt-1.5 text-[11.5px] text-text-faint leading-relaxed">
          应用在后台替你干活时(比如「创意」生成方案),会在这里留一条记录。
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 min-h-0 overflow-y-auto">
      {tasks.map((task) => {
        const meta = STATUS[task.status] || STATUS.done;
        return (
          <button
            key={task.id}
            onClick={() => onOpenTask(task.id, task.title || task.prompt.slice(0, 24))}
            title="在标签页查看详情"
            className="w-full flex items-start gap-2 px-3 py-2 text-left hover:bg-bg-hover"
          >
            <span className={`shrink-0 w-1.5 h-1.5 rounded-full mt-[6px] ${meta.dot}`} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] text-text leading-[18px]">{task.title || task.prompt}</span>
              <span className="block text-[11px] text-text-faint leading-[16px] mt-0.5">
                {task.app_id} · {meta.label} · {ago(task.created_at)}
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

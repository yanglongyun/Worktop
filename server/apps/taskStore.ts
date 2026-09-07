// 任务存取:应用触发的 agent 轮次。
// 记录的过程在 messages 里(task.id 就是那段会话的 id),这里只记发起方与终局。
import { getDb } from "../database/connection.js";

type TaskStatus = "running" | "done" | "error" | "aborted";

export const createTask = ({ id, appId, prompt }: { id: string; appId: string; prompt: string }) => {
  getDb().prepare("INSERT INTO tasks (id, app_id, prompt) VALUES (?, ?, ?)").run(id, appId, prompt);
  return id;
};

export const settleTask = (id: string, status: TaskStatus, error = "") => {
  getDb().prepare(
    "UPDATE tasks SET status = ?, error = ?, updated_at = datetime('now') WHERE id = ?",
  ).run(status, error || null, id);
};

/** 列表:带上会话标题(自动起名后就是人话)。 */
export const listTasks = (limit = 50) =>
  getDb().prepare(`
    SELECT tasks.*, chats.title
    FROM tasks JOIN chats ON chats.id = tasks.id
    ORDER BY tasks.created_at DESC LIMIT ?
  `).all(Math.max(1, Math.min(limit, 200)));

// 浏览记录。
//
// **一个 url 一行**,重复访问只更新时间与次数 —— 逐次追加会让「最近」被同一个站
// 刷屏(刷十次 GitHub 就把别的都挤没了),而用户想找的是「我去过哪些地方」。
//
// 记录只在网页标签里发生的导航;宿主自己的地址不进来。
import { getDb } from "../database/connection.js";
import { emit } from "../bus.js";

type HistoryRow = { url: string; title: string; visits: number; visited_at: string };

const clean = (raw: unknown) => {
  const value = String(raw || "").trim();
  if (!/^https?:\/\//i.test(value)) return ""; // about: / chrome-error: 这些不是「去过的地方」
  try {
    const u = new URL(value);
    u.hash = ""; // 同一页的锚点不算两条
    return u.toString();
  } catch { return ""; }
};

/** 记一次访问。同一个 url 反复来只抬时间和次数。 */
const visit = ({ url, title }: { url?: string; title?: string } = {}) => {
  const clean_url = clean(url);
  if (!clean_url) return null;
  const name = String(title || "").trim().slice(0, 300);
  getDb().prepare(`
    INSERT INTO browser_history (url, title, visits, visited_at) VALUES (?, ?, 1, datetime('now'))
    ON CONFLICT(url) DO UPDATE SET
      visits = visits + 1,
      visited_at = datetime('now'),
      -- 标题可能这次才拿到(导航时页面还没加载完),有新的就用新的
      title = CASE WHEN excluded.title != '' THEN excluded.title ELSE browser_history.title END
  `).run(clean_url, name);
  emit({ type: "history_changed" });
  return true;
};

/** 最近去过的地方。带 q 就按标题与地址搜。 */
const list = ({ q, limit }: { q?: string; limit?: number } = {}) => {
  const take = Math.min(Math.max(Number(limit) || 200, 1), 500);
  const keyword = String(q || "").trim();
  if (!keyword) {
    return getDb()
      .prepare("SELECT * FROM browser_history ORDER BY visited_at DESC LIMIT ?")
      .all(take) as unknown as HistoryRow[];
  }
  const like = `%${keyword}%`;
  return getDb()
    .prepare("SELECT * FROM browser_history WHERE title LIKE ? OR url LIKE ? ORDER BY visited_at DESC LIMIT ?")
    .all(like, like, take) as unknown as HistoryRow[];
};

/** 忘掉一条,或全部。删除是用户对自己记录的处置权,必须有。 */
const forget = ({ url, all }: { url?: string; all?: boolean } = {}) => {
  const db = getDb();
  if (all) { db.prepare("DELETE FROM browser_history").run(); emit({ type: "history_changed" }); return true; }
  const target = clean(url) || String(url || "");
  if (!target) return false;
  const gone = db.prepare("DELETE FROM browser_history WHERE url = ?").run(target).changes > 0;
  if (gone) emit({ type: "history_changed" });
  return gone;
};

export { visit, list, forget };

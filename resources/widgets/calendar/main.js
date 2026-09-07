const post = (path, body) =>
  fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
    .then((r) => r.json());
const sql = (q, params = []) => post("/widgets/sql", { sql: q, params });
const esc = (s) => String(s).replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" }[c]));

await sql(`CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  day TEXT NOT NULL,
  text TEXT NOT NULL
)`);
await sql("CREATE INDEX IF NOT EXISTS idx_events_day ON events (day)");

const WEEK = ["一", "二", "三", "四", "五", "六", "日"];
week.innerHTML = WEEK.map((w) => `<div>${w}</div>`).join("");

const key = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
let cursor = new Date();
let selected = key(new Date());

// ── 中国节假日:holiday-cn 数据(国务院口径,含调休)。按年取,localStorage 缓存 7 天 ──
const holidays = new Map(); // "YYYY-MM-DD" → { name, off: true|false }
const yearLoads = new Map(); // year → Promise,并发的 render 等同一次请求

const fetchYear = (year) => {
  if (!yearLoads.has(year)) yearLoads.set(year, loadYear(year));
  return yearLoads.get(year);
};

const loadYear = async (year) => {
  const cacheKey = `holiday-${year}`;
  let data = null;
  try {
    const hit = JSON.parse(localStorage.getItem(cacheKey));
    if (hit && Date.now() - hit.at < 7 * 24 * 3600 * 1000) data = hit.days;
  } catch { /* 缓存坏了就重取 */ }
  if (!data) {
    for (const host of ["cdn.jsdelivr.net", "fastly.jsdelivr.net"]) {
      try {
        const r = await post("/widgets/http", { url: `https://${host}/gh/NateScarlet/holiday-cn@master/${year}.json` });
        if (!r.ok || r.status !== 200) continue;
        data = JSON.parse(r.text).days || [];
        localStorage.setItem(cacheKey, JSON.stringify({ at: Date.now(), days: data }));
        break;
      } catch { /* 换下一个源 */ }
    }
  }
  for (const d of data || []) holidays.set(d.date, { name: d.name, off: d.isOffDay });
};

const render = async () => {
  const y = cursor.getFullYear(), m = cursor.getMonth();
  title.textContent = `${y} 年 ${m + 1} 月`;
  const first = new Date(y, m, 1);
  const start = new Date(y, m, 1 - ((first.getDay() + 6) % 7));
  const cells = Array.from({ length: 42 }, (_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i));
  await Promise.all([...new Set(cells.map((d) => d.getFullYear()))].map(fetchYear));
  const { rows } = await sql("SELECT day, COUNT(*) AS n FROM events WHERE day BETWEEN ? AND ? GROUP BY day",
    [key(cells[0]), key(cells[41])]);
  const marked = new Set(rows.map((r) => r.day));
  const todayKey = key(new Date());
  days.innerHTML = cells.map((d) => {
    const k = key(d);
    const holiday = holidays.get(k);
    const cls = ["day", d.getMonth() !== m ? "out" : "", k === todayKey ? "today" : "", k === selected ? "sel" : ""].filter(Boolean).join(" ");
    const badge = holiday ? `<span class="hb ${holiday.off ? "off" : "work"}">${holiday.off ? "休" : "班"}</span>` : "";
    return `<div class="${cls}" data-day="${k}">${d.getDate()}${badge}${marked.has(k) ? '<span class="dot"></span>' : ""}</div>`;
  }).join("");
  renderDay();
};

const renderDay = async () => {
  const [, m, d] = selected.split("-").map(Number);
  const holiday = holidays.get(selected);
  daytitle.innerHTML = `${m} 月 ${d} 日` +
    (holiday ? ` <span class="holiname">· ${esc(holiday.name)}${holiday.off ? "(休)" : "(调休上班)"}</span>` : "");
  const { rows } = await sql("SELECT * FROM events WHERE day = ? ORDER BY id", [selected]);
  events.innerHTML = rows.map((e) => `
    <li><span>${esc(e.text)}</span><button class="iconbtn" data-del="${e.id}" title="删除">×</button></li>`).join("");
};

days.onclick = (e) => {
  const day = e.target.closest("[data-day]")?.dataset.day;
  if (!day) return;
  selected = day;
  render();
};
prev.onclick = () => { cursor = new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1); render(); };
next.onclick = () => { cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1); render(); };
today.onclick = () => { cursor = new Date(); selected = key(new Date()); render(); };

form.onsubmit = async (e) => {
  e.preventDefault();
  const value = text.value.trim();
  if (!value) return;
  await sql("INSERT INTO events (day, text) VALUES (?, ?)", [selected, value]);
  text.value = "";
  render();
};
events.onclick = async (e) => {
  const id = e.target.closest("[data-del]")?.dataset.del;
  if (!id) return;
  await sql("DELETE FROM events WHERE id = ?", [id]);
  render();
};

render();

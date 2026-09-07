const post = (path, body) =>
  fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
    .then((r) => r.json());
const sql = (q, params = []) => post("/widgets/sql", { sql: q, params });
const esc = (s) => String(s).replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" }[c]));

await sql(`CREATE TABLE IF NOT EXISTS notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  text TEXT NOT NULL,
  at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
)`);

const render = async () => {
  const { rows } = await sql("SELECT * FROM notes ORDER BY id DESC LIMIT 100");
  list.innerHTML = rows.map((n) => `
    <li><p>${esc(n.text)}</p><em>${n.at.slice(5, 16)}</em>
    <button class="iconbtn" data-del="${n.id}" title="删除">×</button></li>`).join("")
    || '<li class="empty">还没有便签</li>';
};

const submit = async () => {
  const value = text.value.trim();
  if (!value) return;
  await sql("INSERT INTO notes (text) VALUES (?)", [value]);
  text.value = "";
  render();
};
form.onsubmit = (e) => { e.preventDefault(); submit(); };
text.onkeydown = (e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); submit(); } };

list.onclick = async (e) => {
  const id = e.target.closest("[data-del]")?.dataset.del;
  if (!id) return;
  await sql("DELETE FROM notes WHERE id = ?", [id]);
  render();
};

render();

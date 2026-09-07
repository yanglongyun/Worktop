const post = (path, body) =>
  fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
    .then((r) => r.json());
const sql = (q, params = []) => post("/widgets/sql", { sql: q, params });
const esc = (s) => String(s).replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" }[c]));

await sql(`CREATE TABLE IF NOT EXISTS todos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  text TEXT NOT NULL,
  done INTEGER NOT NULL DEFAULT 0
)`);

const render = async () => {
  const { rows } = await sql("SELECT * FROM todos ORDER BY done, id DESC");
  list.innerHTML = rows.map((t) => `
    <li class="${t.done ? "done" : ""}">
      <input type="checkbox" class="check" data-toggle="${t.id}" ${t.done ? "checked" : ""}>
      <span>${esc(t.text)}</span>
      <button class="iconbtn" data-del="${t.id}" title="删除">×</button>
    </li>`).join("") || '<li class="empty">今天没有要办的事</li>';
  const left = rows.filter((t) => !t.done).length;
  stat.textContent = rows.length ? `未完 ${left} · 共 ${rows.length}` : "";
  clear.hidden = !rows.some((t) => t.done);
};

form.onsubmit = async (e) => {
  e.preventDefault();
  const value = text.value.trim();
  if (!value) return;
  await sql("INSERT INTO todos (text) VALUES (?)", [value]);
  text.value = "";
  render();
};

list.onclick = async (e) => {
  const del = e.target.closest("[data-del]")?.dataset.del;
  const toggle = e.target.dataset?.toggle;
  if (del) await sql("DELETE FROM todos WHERE id = ?", [del]);
  else if (toggle) await sql("UPDATE todos SET done = 1 - done WHERE id = ?", [toggle]);
  else return;
  render();
};

clear.onclick = async () => { await sql("DELETE FROM todos WHERE done = 1"); render(); };

render();

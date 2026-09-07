const post = (path, body) =>
  fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
    .then((r) => r.json());
const sql = (q, params = []) => post("/widgets/sql", { sql: q, params });
const esc = (s) => String(s).replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" }[c]));

await sql(`CREATE TABLE IF NOT EXISTS history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  value TEXT NOT NULL,
  at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
)`);

const SETS = {
  upper: "ABCDEFGHIJKLMNOPQRSTUVWXYZ",
  lower: "abcdefghijklmnopqrstuvwxyz",
  digit: "0123456789",
  symbol: "!@#$%^&*-_=+?~",
};
const AMBIGUOUS = /[0O1lI]/g;
const boxes = { upper, lower, digit, symbol };

const colorize = (value) => [...value].map((c) =>
  /\d/.test(c) ? `<span class="d">${c}</span>` :
  /[a-zA-Z]/.test(c) ? c : `<span class="s">${esc(c)}</span>`).join("");

const make = () => {
  let picked = Object.entries(SETS).filter(([k]) => boxes[k].checked);
  if (!picked.length) { lower.checked = true; picked = [["lower", SETS.lower]]; }
  const strip = (s) => plain.checked ? s.replace(AMBIGUOUS, "") : s;
  const pools = picked.map(([, s]) => strip(s)).filter(Boolean);
  const all = pools.join("");
  const n = Number(len.value);
  const rand = new Uint32Array(n);
  crypto.getRandomValues(rand);
  // 每个勾选的字符集先保底出一个,剩下的从全集里抽,最后洗牌
  const chars = pools.map((pool, i) => pool[rand[i] % pool.length]);
  for (let i = pools.length; i < n; i++) chars.push(all[rand[i] % all.length]);
  const shuffle = new Uint32Array(n);
  crypto.getRandomValues(shuffle);
  for (let i = n - 1; i > 0; i--) {
    const j = shuffle[i] % (i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  const value = chars.slice(0, n).join("");
  // 强度 = 组合空间的位数
  const bits = Math.round(n * Math.log2(all.length || 1));
  return { value, bits };
};

const show = ({ value, bits }) => {
  pw.innerHTML = colorize(value);
  pw.dataset.value = value;
  const ratio = Math.min(bits / 128, 1);
  const bar = meter.firstElementChild;
  bar.style.width = `${Math.max(ratio * 100, 6)}%`;
  bar.style.background = bits < 50 ? "var(--danger)" : bits < 90 ? "#e8a23d" : "#1ba158";
};

const renderHist = async () => {
  const { rows } = await sql("SELECT * FROM history ORDER BY id DESC LIMIT 30");
  hist.innerHTML = rows.map((h) => `
    <li data-copy="${esc(h.value)}" title="点击复制">
      <code>${colorize(h.value)}</code><em>${h.at.slice(5, 16)}</em>
      <button class="iconbtn" data-del="${h.id}" title="删除">×</button>
    </li>`).join("") || '<li class="empty">还没生成过</li>';
  clearhist.hidden = !rows.length;
};

gen.onclick = async () => {
  const made = make();
  show(made);
  await sql("INSERT INTO history (value) VALUES (?)", [made.value]);
  renderHist();
};

// 调参只预览,不写记录 —— 记录只留「生成」按钮按下的那些
len.oninput = () => { lenv.textContent = len.value; show(make()); };
for (const box of [...Object.values(boxes), plain]) box.onchange = () => show(make());

copy.onclick = async () => {
  await navigator.clipboard.writeText(pw.dataset.value || "");
  copy.textContent = "已复制";
  setTimeout(() => { copy.textContent = "复制"; }, 1200);
};

hist.onclick = async (e) => {
  const del = e.target.closest("[data-del]")?.dataset.del;
  if (del) {
    e.stopPropagation();
    await sql("DELETE FROM history WHERE id = ?", [del]);
    renderHist();
    return;
  }
  const li = e.target.closest("[data-copy]");
  if (!li) return;
  await navigator.clipboard.writeText(li.dataset.copy);
  li.classList.add("copied");
  setTimeout(() => li.classList.remove("copied"), 800);
};

clearhist.onclick = async () => { await sql("DELETE FROM history"); renderHist(); };

show(make());
renderHist();

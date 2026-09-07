const post = (path, body) =>
  fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
    .then((r) => r.json());
const sql = (q, params = []) => post("/widgets/sql", { sql: q, params });
const esc = (s) => String(s).replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" }[c]));

await sql("CREATE TABLE IF NOT EXISTS feeds (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, url TEXT NOT NULL UNIQUE)");
const seeded = await sql("SELECT COUNT(*) AS n FROM feeds");
if (!seeded.rows[0].n) {
  for (const [name, url] of [
    ["少数派", "https://sspai.com/feed"],
    ["爱范儿", "https://www.ifanr.com/feed"],
    ["Solidot", "https://www.solidot.org/index.rss"],
    ["阮一峰的网络日志", "https://www.ruanyifeng.com/blog/atom.xml"],
  ]) await sql("INSERT INTO feeds (name, url) VALUES (?, ?)", [name, url]);
}

let feeds = [];
let current = Number(localStorage.getItem("feed")) || 0;
const cache = new Map(); // feedId → { at, items }
const TTL = 10 * 60 * 1000;

const loadFeeds = async () => {
  feeds = (await sql("SELECT * FROM feeds ORDER BY id")).rows;
  if (!feeds.some((f) => f.id === current)) current = feeds[0]?.id || 0;
  feedsel.innerHTML = feeds.map((f) => `<option value="${f.id}">${esc(f.name)}</option>`).join("");
  feedsel.value = String(current);
  feedlist.innerHTML = feeds.map((f) => `
    <li><span class="n">${esc(f.name)}</span><span class="u">${esc(f.url)}</span>
    <button class="iconbtn" data-del="${f.id}" title="退订">×</button></li>`).join("")
    || '<li class="empty">一个订阅都没有</li>';
};

// RSS 2.0 与 Atom 都认
const parseFeed = (xml) => {
  const doc = new DOMParser().parseFromString(xml, "text/xml");
  if (doc.querySelector("parsererror")) throw new Error("不是合法的 RSS/Atom");
  const feedTitle = doc.querySelector("channel > title, feed > title")?.textContent?.trim() || "";
  const items = [...doc.querySelectorAll("item, entry")].slice(0, 30).map((it) => {
    const linkEl = it.querySelector("link");
    const link = (linkEl?.getAttribute("href") || linkEl?.textContent || "").trim();
    const when = it.querySelector("pubDate, published, updated")?.textContent || "";
    return {
      title: it.querySelector("title")?.textContent?.trim() || "(无标题)",
      link,
      at: new Date(when),
    };
  });
  if (!items.length) throw new Error("feed 是空的");
  return { feedTitle, items };
};

const ago = (date) => {
  const ms = Date.now() - date.getTime();
  if (!Number.isFinite(ms) || ms < 0) return "";
  const h = ms / 3600000;
  if (h < 1) return `${Math.max(1, Math.round(ms / 60000))} 分钟前`;
  if (h < 24) return `${Math.round(h)} 小时前`;
  return `${Math.round(h / 24)} 天前`;
};

const show = (items, name) => {
  list.innerHTML = items.map((it) => `
    <a class="item" href="${esc(it.link)}">
      <div class="t">${esc(it.title)}</div>
      <div class="m">${esc(name)}${ago(it.at) ? " · " + ago(it.at) : ""}</div>
    </a>`).join("");
};

// 链接开进工作台的网页标签(/widgets/open),不去系统浏览器
list.onclick = (e) => {
  const a = e.target.closest("a.item");
  if (!a) return;
  e.preventDefault();
  void post("/widgets/open", { url: a.getAttribute("href") });
};

const load = async (force = false) => {
  const feed = feeds.find((f) => f.id === current);
  if (!feed) { list.innerHTML = '<div class="empty">加一个订阅吧</div>'; return; }
  const hit = cache.get(feed.id);
  if (!force && hit && Date.now() - hit.at < TTL) return show(hit.items, feed.name);
  list.innerHTML = '<div class="empty">加载中…</div>';
  try {
    const r = await post("/widgets/http", { url: feed.url });
    if (!r.ok) throw new Error(r.error);
    const { items } = parseFeed(r.text);
    cache.set(feed.id, { at: Date.now(), items });
    show(items, feed.name);
  } catch (e) {
    list.innerHTML = `<div class="err">拿不到 ${esc(feed.name)}:${esc(e.message)}</div>`;
  }
};

feedsel.onchange = () => { current = Number(feedsel.value); localStorage.setItem("feed", current); load(); };
refresh.onclick = () => load(true);
manage.onclick = () => { panel.hidden = !panel.hidden; if (!panel.hidden) feedurl.focus(); };

addform.onsubmit = async (e) => {
  e.preventDefault();
  const url = feedurl.value.trim();
  if (!url) return;
  feedurl.disabled = true;
  try {
    const r = await post("/widgets/http", { url });
    if (!r.ok) throw new Error(r.error);
    const { feedTitle } = parseFeed(r.text);
    const name = feedTitle || new URL(url).hostname;
    const ins = await sql("INSERT INTO feeds (name, url) VALUES (?, ?)", [name, url]);
    if (!ins.ok) throw new Error(ins.error?.includes("UNIQUE") ? "已经订过了" : ins.error);
    feedurl.value = "";
    current = ins.lastInsertRowid;
    localStorage.setItem("feed", current);
    await loadFeeds();
    load();
  } catch (err) {
    feedurl.setCustomValidity(String(err.message));
    feedurl.reportValidity();
    setTimeout(() => feedurl.setCustomValidity(""), 1600);
  } finally { feedurl.disabled = false; feedurl.focus(); }
};

feedlist.onclick = async (e) => {
  const id = e.target.closest("[data-del]")?.dataset.del;
  if (!id) return;
  await sql("DELETE FROM feeds WHERE id = ?", [id]);
  await loadFeeds();
  load();
};

await loadFeeds();
load();

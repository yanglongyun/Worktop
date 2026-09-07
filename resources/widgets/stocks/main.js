const post = (path, body) =>
  fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
    .then((r) => r.json());
const esc = (s) => String(s).replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" }[c]));

const DEFAULT = ["sh000001", "sz399001", "sz399006", "hkHSI", "usNDX"];
let codes = DEFAULT;
try { codes = JSON.parse(localStorage.getItem("codes")) || DEFAULT; } catch { /* 用缺省 */ }
const save = () => localStorage.setItem("codes", JSON.stringify(codes));

const load = async () => {
  if (!codes.length) { list.innerHTML = '<div class="empty">加一个代码看看</div>'; stamp.textContent = ""; return; }
  try {
    const r = await post("/widgets/http", { url: "https://qt.gtimg.cn/q=" + codes.join(",") });
    if (!r.ok) throw new Error(r.error);
    // 返回形如 v_sh000001="1~上证指数~000001~3986.30~3952.18~…";  字段:1 名称 3 现价 4 昨收
    const quotes = new Map();
    for (const m of r.text.matchAll(/v_(\w+)="([^"]*)"/g)) quotes.set(m[1], m[2].split("~"));
    list.innerHTML = codes.map((code) => {
      const f = quotes.get(code);
      if (!f || f.length < 5 || !f[1]) return `
        <div class="stk" data-code="${esc(code)}"><span class="name">${esc(code)}<small>代码无效</small></span><span></span>
        <span class="pct flat">—</span><button class="iconbtn" data-del="${esc(code)}">×</button></div>`;
      const price = Number(f[3]), prev = Number(f[4]);
      const delta = price - prev, pct = prev ? (delta / prev) * 100 : 0;
      const cls = delta > 0.0001 ? "up" : delta < -0.0001 ? "down" : "flat";
      const sign = delta > 0 ? "+" : "";
      return `
        <div class="stk" data-code="${esc(code)}">
          <span class="name">${esc(f[1])}<small>${esc(code.toUpperCase())}</small></span>
          <span class="price">${price ? price.toFixed(2) : "—"}</span>
          <span class="pct ${cls}">${price ? sign + pct.toFixed(2) + "%" : "—"}</span>
          <button class="iconbtn" data-del="${esc(code)}" title="移除">×</button>
        </div>`;
    }).join("");
    stamp.textContent = "更新于 " + new Date().toTimeString().slice(0, 5);
  } catch (e) {
    list.innerHTML = `<div class="err">拿不到行情:${esc(e.message)}</div>`;
  }
};

form.onsubmit = (e) => {
  e.preventDefault();
  const value = code.value.trim().toLowerCase().replace(/^us(.+)$/, (_, t) => "us" + t.toUpperCase());
  if (!value || codes.includes(value)) return;
  if (!/^(sh|sz|hk|us)\w{1,12}$/.test(value)) { code.select(); return; }
  codes.push(value); save(); code.value = "";
  load();
};
list.onclick = (e) => {
  const del = e.target.closest("[data-del]")?.dataset.del;
  if (del) {
    codes = codes.filter((c) => c !== del); save();
    load();
    return;
  }
  // 点行 = 在工作台里开这只标的的行情页(雪球代码形如 SH000001 / HK00700 / AAPL)
  const row = e.target.closest("[data-code]");
  if (!row) return;
  const code = row.dataset.code;
  const symbol = code.startsWith("us") ? code.slice(2) : code.toUpperCase();
  void post("/widgets/open", { url: `https://xueqiu.com/S/${symbol}` });
};
refresh.onclick = load;

load();
setInterval(load, 30 * 1000);

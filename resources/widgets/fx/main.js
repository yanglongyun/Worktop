const post = (path, body) =>
  fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
    .then((r) => r.json());

const CCY = [
  ["CNY", "人民币"], ["USD", "美元"], ["EUR", "欧元"], ["JPY", "日元"],
  ["HKD", "港币"], ["GBP", "英镑"], ["KRW", "韩元"], ["AUD", "澳元"], ["SGD", "新币"], ["CHF", "瑞郎"],
];
const from_ = document.getElementById("from");
const to_ = document.getElementById("to");
const amountEl = document.getElementById("amount");
for (const sel of [from_, to_])
  sel.innerHTML = CCY.map(([c, n]) => `<option value="${c}">${c} ${n}</option>`).join("");

let pair = { from: "USD", to: "CNY" };
try { pair = JSON.parse(localStorage.getItem("pair")) || pair; } catch { /* 用缺省 */ }
from_.value = pair.from; to_.value = pair.to;
if (!from_.value) from_.value = "USD";
if (!to_.value) to_.value = "CNY";

const cache = new Map(); // base → { at, rates, date }
const TTL = 60 * 60 * 1000;

const getRates = async (base) => {
  const hit = cache.get(base);
  if (hit && Date.now() - hit.at < TTL) return hit;
  const symbols = CCY.map(([c]) => c).filter((c) => c !== base).join(",");
  const r = await post("/widgets/http", { url: `https://api.frankfurter.dev/v1/latest?base=${base}&symbols=${symbols}` });
  if (!r.ok) throw new Error(r.error);
  const d = JSON.parse(r.text);
  const entry = { at: Date.now(), rates: { ...d.rates, [base]: 1 }, date: d.date };
  cache.set(base, entry);
  return entry;
};

const fmt = (n) => n.toLocaleString("zh-CN", { maximumFractionDigits: n >= 100 ? 2 : 4 });

const render = async () => {
  const base = from_.value, target = to_.value;
  localStorage.setItem("pair", JSON.stringify({ from: base, to: target }));
  try {
    const { rates, date: day } = await getRates(base);
    const amount = Number(amountEl.value) || 0;
    result.innerHTML = `${fmt(amount * rates[target])}<small>${target}</small>`;
    rate.textContent = `1 ${base} = ${fmt(rates[target])} ${target}`;
    date.textContent = day;
    grid.innerHTML = CCY.filter(([c]) => c !== base).map(([c, n]) =>
      `<div class="cell"><span>${n} ${c}</span><b>${fmt(rates[c])}</b></div>`).join("");
  } catch (e) {
    result.textContent = "—";
    rate.textContent = ""; date.textContent = "";
    grid.innerHTML = `<div class="err" style="grid-column:1/-1">拿不到汇率:${String(e.message)}</div>`;
  }
};

from_.onchange = render;
to_.onchange = render;
amountEl.oninput = render;
swap.onclick = () => { const t = from_.value; from_.value = to_.value; to_.value = t; render(); };

render();

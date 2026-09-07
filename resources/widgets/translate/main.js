const post = (path, body) =>
  fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
    .then((r) => r.json());

const AUTO = "自动检测";
const LANGS = [
  "中文", "英语", "日语", "韩语", "法语", "德语", "西班牙语", "俄语", "葡萄牙语",
  "意大利语", "阿拉伯语", "泰语", "越南语", "印尼语", "土耳其语", "荷兰语", "波兰语", "繁体中文",
];
const srcLang = document.getElementById("src_lang");
const dstLang = document.getElementById("dst_lang");
srcLang.innerHTML = [AUTO, ...LANGS].map((l) => `<option>${l}</option>`).join("");
dstLang.innerHTML = LANGS.map((l) => `<option>${l}</option>`).join("");

let saved = { src: AUTO, dst: "中文" };
try { saved = JSON.parse(localStorage.getItem("langs")) || saved; } catch { /* 用缺省 */ }
srcLang.value = saved.src; dstLang.value = saved.dst;
if (!srcLang.value) srcLang.value = AUTO;
if (!dstLang.value) dstLang.value = "中文";
const remember = () => localStorage.setItem("langs", JSON.stringify({ src: srcLang.value, dst: dstLang.value }));

swap.onclick = () => {
  const a = srcLang.value, b = dstLang.value;
  // 源是「自动检测」时没法真交换:目标顶上来,源变成刚才的目标
  dstLang.value = a === AUTO ? (b === "中文" ? "英语" : "中文") : a;
  srcLang.value = b;
  remember();
  if (src.value.trim()) run();
};
srcLang.onchange = remember;
dstLang.onchange = () => { remember(); if (src.value.trim()) run(); };

let busy = false;
const run = async () => {
  const value = src.value.trim();
  if (!value || busy) return;
  busy = true; go.disabled = true;
  outcard.hidden = false;
  out.className = "waiting"; out.textContent = "翻译中…";
  const fromNote = srcLang.value === AUTO ? "" : `原文是${srcLang.value}。`;
  const r = await post("/widgets/ai", {
    summary: `翻译成${dstLang.value}`,
    system: `你是专业译者。${fromNote}把用户给的文字翻译成${dstLang.value},只输出译文,不解释、不加引号。语气与原文一致,术语按行业惯例。`,
    prompt: value,
  }).catch((e) => ({ ok: false, error: String(e) }));
  out.className = "";
  out.textContent = r.ok ? r.text : `出错了:${r.error}`;
  busy = false; go.disabled = false;
};

go.onclick = run;
src.onkeydown = (e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); run(); } };

copy.onclick = async () => {
  await navigator.clipboard.writeText(out.textContent);
  copy.textContent = "已复制";
  setTimeout(() => { copy.textContent = "复制"; }, 1200);
};

import { mdToHtml } from "./md.js";

const post = (path, body) =>
  fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
    .then((r) => r.json());

let busy = false;

const ask = async () => {
  const q = text.value.trim();
  if (!q || busy) return;
  busy = true; send.disabled = true;
  anscard.hidden = false; copy.hidden = true;
  ans.className = "ans waiting";
  ans.innerHTML = "<i>·</i><i>·</i><i>·</i>";
  const r = await post("/widgets/ai", {
    summary: "快速问答:" + q.slice(0, 60),
    system: "你在一个侧栏小组件里回答一次性的小问题。用中文,直接给答案,简短、准确;代码或命令用行内形式;不要开场白、不要追问。",
    prompt: q,
  }).catch((e) => ({ ok: false, error: String(e) }));
  if (r.ok) { ans.className = "ans md"; ans.innerHTML = mdToHtml(r.text); ans.dataset.raw = r.text; copy.hidden = false; }
  else { ans.className = "ans err"; ans.textContent = `出错了:${r.error}`; }
  busy = false; send.disabled = false;
  clear.hidden = false;
};

form.onsubmit = (e) => { e.preventDefault(); ask(); };
text.onkeydown = (e) => {
  if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); ask(); }
};

copy.onclick = async () => {
  await navigator.clipboard.writeText(ans.dataset.raw || ans.textContent);
  copy.textContent = "已复制";
  setTimeout(() => { copy.textContent = "复制"; }, 1200);
};

clear.onclick = () => {
  text.value = "";
  anscard.hidden = true;
  clear.hidden = true;
  text.focus();
};

// 答案里的链接开进工作台标签(/widgets/open),不去系统浏览器
ans.onclick = (e) => {
  const a = e.target.closest("a[href]");
  if (!a) return;
  e.preventDefault();
  void post("/widgets/open", { url: a.getAttribute("href") });
};

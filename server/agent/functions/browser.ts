// @ts-nocheck
// browser:操作工作区里的网页标签(真浏览器、真登录态)。
//
// **操作走 CDP**(Chrome DevTools Protocol,见 desktop/browser/):Input 域派发的
// 事件 isTrusted=true,和用户自己动手没有区别 —— 从前在页面里 el.click() 是合成事件,
// 文件选择、拖放、部分框架的手势判定都不认。定位也不再靠猜 CSS 选择器:
// snapshot 给一张无障碍树的清单,一行一个可交互元素带 ref,照着 ref 点。
// 执行端是 Electron 壳里的 <webview>(浏览器宿主见 server/browserHost.ts):
// 指令广播给 UI,拥有该标签的窗口执行后应答;用户全程在界面上看得见 AI 在哪个页面干什么。
// AI 开的网页按策略落在分屏侧组 —— 左边对话继续流,右边看着 AI 操作。
// 纯浏览器/dev(没有桌面壳)时诚实报错,不装能行。
import { writeFileSync, mkdirSync } from "fs";
import { dirname, join } from "path";
import { resolveLocalPath } from "../paths.js";
import { browserRequest, hasHost, listTabs, openTab } from "../../browser/host.js";

export const browserDef = {
  type: "function",
  name: "browser",
  description:
    "操作工作区里的网页标签(Worktop 内置真浏览器,带用户的真实登录态)。" +
    "【定位】先 snapshot 拿页面清单:一行一个可交互元素,形如 [n3-12] button \"登录\"。" +
    "之后的操作用 ref 指定目标,并带上 page_version(snapshot 返回的);页面变了 ref 会失效,重新 snapshot。" +
    "【动作】list 列出已开标签(拿 tab_id);open 打开网址成新标签;navigate/back 跳转后退;" +
    "snapshot 读页面结构;read 读正文文本;click/double_click/hover 点击悬停;" +
    "fill 填输入框(必须给 value,清空写空串);select 选下拉项;press 按键(Enter/Tab/Escape/方向键等);" +
    "scroll 滚动(delta_y);js 在隔离世界执行 JavaScript;screenshot 截图保存为本地 PNG。" +
    "除 list/open 外都必须带 tab_id(先 list)。",
  parameters: {
    type: "object",
    properties: {
      summary: { type: "string", description: "一句话说明这次操作的目的(界面会显示)" },
      action: {
        type: "string",
        enum: [
          "list", "open", "navigate", "back", "snapshot", "read", "js",
          "click", "double_click", "hover", "fill", "select", "press", "scroll", "screenshot",
        ],
        description: "要执行的动作",
      },
      tab_id: { type: "number", description: "目标标签 id(action=list 返回;除 list/open 外必填)" },
      url: { type: "string", description: "open/navigate:要打开的网址" },
      ref: { type: "string", description: "目标元素的 ref(snapshot 里的 [n3-12] 那个);点/填/选都用它定位" },
      page_version: { type: "number", description: "snapshot 返回的 pageVersion;不带就不校验(页面可能已经变了)" },
      value: { type: "string", description: "fill:要填的文本(清空写空串);select:要选的项(值或可见文字)" },
      key: { type: "string", description: "press:键名。Enter / Tab / Escape / Backspace / 方向键 / PageUp 等" },
      delta_y: { type: "number", description: "scroll:纵向滚动量,正数向下,默认 400" },
      x: { type: "number", description: "兜底:按坐标操作(结构化定位不到时,比如 canvas 里的东西)" },
      y: { type: "number", description: "兜底:按坐标操作,与 x 一起给" },
      max_nodes: { type: "number", description: "snapshot:最多返回多少行,默认 400" },
      code: { type: "string", description: "js:要在页面里执行的 JavaScript 表达式" },

      text: { type: "string", description: "type:要输入的文本" },
      path: { type: "string", description: "screenshot 可选:保存路径,支持绝对路径或 ~/;默认保存到本轮产物目录" },
    },
    required: ["summary", "action"],
    additionalProperties: false,
  },
};

const fmtTab = (tab) => `[${tab.id}] ${tab.title || "(无标题)"} — ${tab.url}`;

export const browser = async ({
  action, tab_id, url, code, path: savePath,
  ref, page_version, value, text, key, delta_y, x, y, max_nodes,
}, ctx) => {
  const act = String(action || "");
  if (!hasHost() && act !== "list") {
    return "error: browser 不可用 —— 需要在 Worktop 桌面壳(Electron)里运行,当前没有浏览器宿主。";
  }

  try {
    switch (act) {
      case "list": {
        const rows = listTabs();
        if (!rows.length) return hasHost() ? "(当前没有打开的网页标签;用 action=open 打开一个)" : "error: browser 不可用 —— 需要在 Worktop 桌面壳(Electron)里运行。";
        return rows.map(fmtTab).join("\n");
      }
      case "open": {
        const target = String(url || "").trim();
        if (!target) return "error: open 需要 url";
        const normalized = /^[a-z][a-z0-9+.-]*:/i.test(target) ? target : `https://${target}`;
        if (!/^https?:\/\//i.test(normalized)) return "error: 只支持 http(s) 网址";
        const tab = await openTab(normalized);
        return `已在后台打开网页标签 ${fmtTab(tab)}\n(页面可能还在加载;用 read 读正文,用 js/click/type 操作)`;
      }
      case "navigate": {
        const target = String(url || "").trim();
        if (!target) return "error: navigate 需要 url";
        const normalized = /^[a-z][a-z0-9+.-]*:/i.test(target) ? target : `https://${target}`;
        await browserRequest(tab_id, "navigate", { url: normalized }, 30_000);
        return `标签 ${tab_id} 已跳转到 ${normalized}`;
      }
      case "back": {
        await browserRequest(tab_id, "back", {}, 10_000);
        return `标签 ${tab_id} 已后退`;
      }
      case "read": {
        const result = await browserRequest(tab_id, "read", {}, 20_000);
        return `title: ${result?.title || ""}\nurl: ${result?.url || ""}\n\n${result?.text || "(页面没有可读文本)"}`;
      }
      case "js": {
        if (!String(code || "").trim()) return "error: js 需要 code";
        const result = await browserRequest(tab_id, "js", { code: String(code) }, 20_000);
        return String(result ?? "undefined");
      }
      case "snapshot": {
        const snap = await browserRequest(tab_id, "snapshot", { max_nodes }, 30_000);
        const head = `${snap.title || ""}\n${snap.url}\npageVersion=${snap.pageVersion}`;
        const body = (snap.lines || []).join("\n") || "(这一页没有可交互元素)";
        // 截断要说出来 —— 模型不知道自己看的是残页的话会以为「没有那个按钮」
        return `${head}\n\n${body}${snap.truncated ? "\n\n(元素太多已截断,必要时提高 max_nodes)" : ""}`;
      }
      case "click":
      case "double_click":
      case "hover":
      case "fill":
      case "select":
      case "press":
      case "scroll": {
        if (ref == null && !(Number.isFinite(Number(x)) && Number.isFinite(Number(y)))) {
          return `error: ${action} 需要 ref(先 snapshot 拿),或者给 x/y 按坐标兜底`;
        }
        // fill 少给 value 必须当场报错:当成空串会清空输入框却报成功,
        // 调用方以为填进去了,下一步就发出一条空的
        if (action === "fill" && value == null && text == null) {
          return 'error: fill 需要 value(要填什么)。清空请显式写 value: ""';
        }
        const result = await browserRequest(tab_id, action, {
          ref, page_version, value: value ?? text, key, delta_y, x, y,
        }, 30_000);
        const note = result?.navigated ? `(地址变成 ${result.url},快照已作废,重新 snapshot)` : "";
        return `ok ${note}`.trim();
      }
      case "screenshot": {
        const dataUrl = await browserRequest(tab_id, "screenshot", {}, 25_000);
        const base64 = String(dataUrl || "").replace(/^data:image\/\w+;base64,/, "");
        if (!base64) return "error: 截图失败(宿主没有返回图像)";
        const bytes = Buffer.from(base64, "base64");
        const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "").replace("T", "-");
        const requested = String(savePath || "").trim();
        const abs = requested ? resolveLocalPath(requested, ctx.cwd)
          : resolveLocalPath(join(ctx.outputDir || ctx.cwd || "~", `web-shot-${stamp}.png`));
        mkdirSync(dirname(abs), { recursive: true });
        writeFileSync(abs, bytes);
        ctx.emit?.({ type: "tree_changed", reason: "browser_screenshot", paths: [abs] });
        // 截图走 image 通道进当前轮上下文,并返回实际保存位置。
        return {
          output: `已截图保存到 ${abs}(${Math.round(bytes.length / 1024)} KB),并已作为图像交给你查看。`,
          image: { path: abs, mimeType: "image/png", size: bytes.length },
        };
      }
      default:
        return `error: 未知 action: ${act}`;
    }
  } catch (error) {
    return `error: ${error?.message || error}`;
  }
};

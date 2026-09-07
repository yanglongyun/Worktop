// 浏览器宿主的渲染进程一半(browser 工具的执行端)。
// <webview> 元素只有渲染进程摸得到 —— executeJavaScript / capturePage / loadURL 都是
// 元素自带的方法,所以宿主就是 UI 自己:WebPanel 把元素登记进来,server 广播的
// browser_request 在这里找到对应标签、执行、应答。不是自己的标签就沉默(别的窗口会答)。
import { useEffect } from "react";

export const IN_ELECTRON = navigator.userAgent.includes("Electron");

type Socket = {
  send: (m: any) => void;
  on: (t: string, fn: (p: any) => void) => () => void;
};

/** wcId(webContents id)→ { el: <webview> 元素, tabId: 工作区标签 id }。 */
const registry = new Map<number, { el: any; tabId: string }>();

export const registerWebview = (wcId: number, el: any, tabId: string) => { registry.set(wcId, { el, tabId }); };
export const unregisterWebview = (wcId: number) => { registry.delete(wcId); };
/** 按 wcId 查它属于哪个工作区标签(壳只知道 webContents,插标签位置要知道来源标签)。 */
export const tabForWcId = (wcId: number): string | null => registry.get(wcId)?.tabId || null;

/** 按工作区标签 id 反查 wcId(browser open 命中已开标签时,拿它带 token 重注册兑现)。 */
export const wcIdForTab = (tabId: string): number | null => {
  for (const [wcId, entry] of registry) if (entry.tabId === tabId) return wcId;
  return null;
};

/** 服务器重启后注册表清零 —— 广播这个事件让每个 WebPanel 重新注册。 */
export const RE_REGISTER_EVENT = "worktop:web-reregister";
/** 截图前把目标标签翻到前台(App 监听):隐藏的 <webview> 画不出图,capturePage 会挂起。 */
const ACTIVATE_EVENT = "worktop:web-activate";

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** 走 CDP(主进程)。<webview> 元素只有渲染层摸得到,debugger 只有主进程摸得到,这一跳绕不开。 */
const viaCdp = async (wcId: number, op: string, params: unknown) => {
  const bridge = window.worktopDesktop;
  if (!bridge?.cdp) throw new Error("需要在桌面应用里使用");
  const result = await bridge.cdp(wcId, op as any, params);
  if (!result.ok) throw new Error(result.error);
  return result.data;
};

const exec = async ({ el, tabId, wcId }: { el: any; tabId: string; wcId: number }, op: string, params: any): Promise<any> => {
  switch (op) {
    case "navigate":
      try {
        await el.loadURL(String(params.url || ""));
      } catch (e: any) {
        // ERR_ABORTED = 首次加载被重定向/二次导航顶掉 —— 页面其实在正常加载,不算失败
        if (!/ERR_ABORTED/i.test(String(e?.message || e))) throw e;
        return "ok(页面发生了重定向或二次导航,已继续加载)";
      }
      return "ok";
    case "back":
      el.goBack();
      return "ok";
    case "read":
      // 隔离世界执行:页面 hook 不到也改不了我们的脚本(主世界里 querySelector 可能被换掉)
      return await viaCdp(wcId, "eval",
        { expression: `(() => { const text = document.body ? document.body.innerText : ""; return { title: document.title, url: location.href, text: text.slice(0, 60000) }; })()` });
    case "js": {
      const raw = await viaCdp(wcId, "eval", { expression: String(params.code || "") });
      if (raw === undefined) return "undefined";
      try { return JSON.stringify(raw, null, 2); } catch { return String(raw); }
    }
    case "snapshot":
      // 无障碍树快照:一行一个可交互元素,带 ref。模型据此点、填,而不是猜 CSS 选择器
      return await viaCdp(wcId, "snapshot", { maxNodes: Number(params.max_nodes) || 400 });
    case "click":
    case "double_click":
    case "hover":
    case "fill":
    case "select":
    case "press":
    case "scroll":
      // **真实输入**:走 CDP 的 Input 域,事件 isTrusted=true,和用户自己动手无区别。
      // 从前是在页面里 el.click(),那是合成事件 —— 文件选择、拖放、部分框架的手势判定都不认
      return await viaCdp(wcId, "act", {
        action: op === "double_click" ? "doubleClick" : op,
        ref: params.ref,
        pageVersion: params.page_version,
        value: params.value ?? params.text,
        key: params.key,
        deltaY: params.delta_y,
        x: params.x,
        y: params.y,
      });
    case "screenshot": {
      // 先把标签翻到前台等一拍再拍:display:none 的 webview 没有画面
      window.dispatchEvent(new CustomEvent(ACTIVATE_EVENT, { detail: { tabId } }));
      await wait(450);
      const image = await el.capturePage();
      const dataUrl = image && typeof image.toDataURL === "function" ? image.toDataURL() : null;
      if (!dataUrl) throw new Error("当前环境不支持截图");
      return dataUrl;
    }
    default:
      throw new Error(`未知操作:${op}`);
  }
};

/** 挂在 App 顶层:声明宿主身份、应答 browser 指令、断线重连后触发重注册。 */
export function useBrowserHost(socket: Socket) {
  useEffect(() => {
    if (!IN_ELECTRON) return;
    socket.send({ type: "web_host_hello" });
    const offConnected = socket.on("connected", () => {
      // 每次(重)连上都重新声明 + 让 webview 重新注册(server 重启后注册表是空的)
      socket.send({ type: "web_host_hello" });
      window.dispatchEvent(new Event(RE_REGISTER_EVENT));
    });
    const offRequest = socket.on("browser_request", async (p: any) => {
      const entry = registry.get(Number(p.wcId));
      if (!entry) return; // 不是这个窗口的标签,拥有它的窗口会应答
      try {
        const result = await exec({ ...entry, wcId: Number(p.wcId) }, String(p.op || ""), p.params || {});
        socket.send({ type: "browser_response", id: p.id, ok: true, result });
      } catch (e: any) {
        socket.send({ type: "browser_response", id: p.id, ok: false, error: String(e?.message || e) });
      }
    });
    return () => { offConnected(); offRequest(); };
  }, [socket]);
}

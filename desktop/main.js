import { randomBytes } from "node:crypto";
// Electron 壳:拉起本地服务(系统 node 跑 esbuild 单文件),窗口指向 127.0.0.1。
//
// 为什么用系统 node 而不是 Electron 自带的 Node:node-pty 是原生模块,按系统 node
// 的 ABI 编译;塞进 Electron 的 Node 要 electron-rebuild 整一轮。开发期直接用系统
// node 零 ABI 纠纷;正式打包时再换成随包 node + rebuild(见 dev/ 版本文档)。
import { app, BrowserWindow, Menu, clipboard, dialog, ipcMain, nativeTheme, session, shell, safeStorage } from "electron";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// sidecar 的 node 可执行文件名:macOS 是 node,Windows 是 node.exe(scripts/prepare-node.mjs 同一规则)
const NODE_BIN = process.platform === "win32" ? "node.exe" : "node";

// 密码列的加密密钥:macOS 由 server 自己去钥匙串取;Windows 没有钥匙串,由壳用 safeStorage(DPAPI)
// 保护一份密钥文件,启动时解出来经环境变量交给 server,永远不明文落盘。
const passwordsKeyEnv = () => {
  if (process.platform !== "win32") return {};
  try {
    if (!safeStorage.isEncryptionAvailable()) return {};
    const file = join(app.getPath("userData"), "passwords.key");
    let hex = "";
    if (existsSync(file)) hex = safeStorage.decryptString(readFileSync(file));
    if (!/^[0-9a-f]{64}$/.test(hex)) {
      hex = randomBytes(32).toString("hex");
      writeFileSync(file, safeStorage.encryptString(hex));
    }
    return { WORKTOP_PASSWORDS_KEY: hex };
  } catch { return {}; }
};

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// ── 名字的两层:内部 slug 永不变,显示名随时可换 ──────────────────────────
// SLUG 是身份:appId(ai.iimos.worktop)、userData 目录、更新通道都用它。
// 它一旦跟着显示名变,macOS 就认为换了个应用 —— 设置、数据、自动更新链全断。
// APP_NAME 只用于人眼可见处(窗口标题、Documents 下的工作区目录)。
const SLUG = "worktop";
const APP_NAME = "Worktop";
// userData 显式钉死:Electron 默认按 productName 取路径,改显示名会让数据"凭空消失"。
app.setPath("userData", join(app.getPath("appData"), SLUG));

let child = null;
let quitting = false;
let hostContents = null; // 宿主界面那层 webContents,导航护栏只认它

/** 开发态:代码在仓库,数据由服务端自己落到 Application Support/Worktop Dev。打包态:代码在只读资源区,数据在 userData。 */
const layout = () => {
  if (!app.isPackaged) {
    return {
      nodeBin: "node",
      serverEntry: join(ROOT, "dist/server.mjs"),
      cwd: ROOT,
      env: {},
    };
  }
  const res = process.resourcesPath;
  return {
    nodeBin: join(res, "core/bin", NODE_BIN),
    serverEntry: join(res, "core/server.mjs"),
    cwd: join(res, "core"), // node-pty 从 core/node_modules 解析
    env: {
      WORKTOP_PACKAGED: "1",                 // 遥测只在打包应用里发,开发态不打点
      WORKTOP_VERSION: app.getVersion(),
      WORKTOP_HOME: app.getPath("userData"), // database/ 落在这里(macOS 惯例:应用数据进 Application Support)
      ...passwordsKeyEnv(),
      WORKTOP_UI_DIST: join(res, "core/ui"),
      WORKTOP_RESOURCES: join(res, "core/resources"),
    },
  };
};

// ── 端口必须**跨启动稳定** ──────────────────────────────────────────────
// 窗口加载 http://127.0.0.1:<port>,而浏览器的 localStorage 按 origin 隔离,
// origin 含端口 —— 每次随机换端口 = 每次都是新 origin = 用户的偏好全部清零
// (主题、侧栏宽度、分屏比例、活动栏上开了哪些组件、聊天草稿、已读公告……)。
// 所以:首次随机选一个,记在 userData 里,以后每次先用它;被占了才另选。
const PORT_FILE = () => join(app.getPath("userData"), "port.json");

const readSavedPort = () => {
  try {
    const port = Number(JSON.parse(readFileSync(PORT_FILE(), "utf8")).port);
    return Number.isInteger(port) && port > 1024 && port < 65536 ? port : 0;
  } catch { return 0; }
};

const savePort = (port) => {
  try { writeFileSync(PORT_FILE(), JSON.stringify({ port }), "utf8"); }
  catch (e) { console.error("[port] 记不住端口,下次启动偏好会重置:", e?.message); }
};

/** 某个端口现在能不能用。 */
const portFree = (port) => new Promise((resolve) => {
  const probe = createServer();
  probe.once("error", () => resolve(false));
  probe.listen(port, "127.0.0.1", () => probe.close(() => resolve(true)));
});

/** 随机要一个空闲端口(交给系统挑)。 */
const freePort = () => new Promise((resolve, reject) => {
  const probe = createServer();
  probe.once("error", reject);
  probe.listen(0, "127.0.0.1", () => {
    const port = probe.address().port;
    probe.close(() => resolve(port));
  });
});

/** 显式给了 WORKTOP_PORT 就用它(比如连已在跑的 dev 服务);否则沿用上次那个。 */
const pickPort = async () => {
  const fixed = Number(process.env.WORKTOP_PORT) || 0;
  if (fixed) return fixed;

  const saved = readSavedPort();
  if (saved && await portFree(saved)) return saved;

  const port = await freePort();
  savePort(port);
  // 换了端口 = 换了 origin,上一次的界面偏好留在旧 origin 里,这一次是空的
  if (saved) console.warn(`[port] 上次的端口 ${saved} 被占,改用 ${port} —— 界面偏好会重置一次`);
  return port;
};

/** GUI 场景(Finder 启动)PATH 很瘦,补上常见的 node 安装位置(开发态用 PATH 找 node)。 */
const spawnEnv = (port, extra) => ({
  ...process.env,
  PATH: [process.env.PATH, "/opt/homebrew/bin", "/usr/local/bin"].filter(Boolean).join(":"),
  WORKTOP_PORT: String(port),
  ...extra,
});

const waitHealthy = async (port, timeoutMs = 15000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/health`);
      if (res.ok) return;
    } catch { /* 还没起来 */ }
    if (child && child.exitCode !== null) throw new Error(`服务进程退出(code ${child.exitCode})`);
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error("等待本地服务超时(15s)");
};

const startServer = async (port) => {
  const { nodeBin, serverEntry, cwd, env } = layout();
  child = spawn(nodeBin, [serverEntry], {
    cwd,
    env: spawnEnv(port, env),
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => process.stdout.write(`[server] ${chunk}`));
  child.stderr.on("data", (chunk) => process.stderr.write(`[server] ${chunk}`));
  child.on("exit", (code) => {
    child = null;
    if (!quitting) {
      dialog.showErrorBox(APP_NAME, `本地服务意外退出(code ${code})。`);
      app.quit();
    }
  });
  await waitHealthy(port);
};


import {
  serveAnswers, serveCertErrors, serveHttpAuth, servePermissions,
} from "./browsing.js";
import { serveDownloads } from "./downloads.js";
import { targetOf, evaluate as cdpEvaluate, send as cdpSend } from "./browser/cdp.js";
import { observe } from "./browser/snapshot.js";
import { act } from "./browser/act.js";
import { bindCursor } from "./browser/cursor.js";

const WEB_PARTITION = "persist:web";
const webSession = () => session.fromPartition(WEB_PARTITION);

/** 给界面派一个事件。没有反向 IPC 通道,沿用 executeJavaScript 那条路。 */
const toRenderer = (name, detail) => {
  const target = BrowserWindow.getAllWindows()[0];
  if (!target) return false;   // 没窗口 = 没人能回答,调用方据此当场拒绝
  target.webContents
    .executeJavaScript(`window.dispatchEvent(new CustomEvent(${JSON.stringify(name)},{detail:${JSON.stringify(detail)}}))`)
    .catch(() => { /* 页面还没加载好,丢了就算 */ });
  return true;
};

/**
 * 新窗口请求分三种去处,和真浏览器一致:
 *
 *   ① 页面里带尺寸的 window.open(disposition = new-window)—— OAuth 登录框是这种。
 *      **必须真开一个窗口**:页面要拿着 window 句柄导航它、收它 postMessage、最后关掉。
 *      我们自己开标签会让 window.open 返回 null,登录库当成被拦截,再开一个 ——
 *      症状是「点一次登录冒出两个标签,第二个还是空白」。
 *   ② 页面里的 target=_blank / 中键 —— 开我们自己的新标签,别顶掉用户正看的那页。
 *   ③ 宿主界面里的外链 —— 系统浏览器。那是产品自己的链接,不该占用户的标签。
 *
 * **宿主界面永远不许被导航走。** setWindowOpenHandler 只管 window.open 和 target=_blank;
 * 普通的 <a href> 是原地导航,走 will-navigate —— 没人拦的话点一下就把整个应用顶掉了。
 */
const routeNewWindows = (port) => {
  const hostOrigin = `http://127.0.0.1:${port}`;
  app.on("web-contents-created", (_event, contents) => {
    // 三类身份,行为完全不同:
    //   宿主界面 —— 只能待在自己的地址上,外链一律甩出去
    //   webview  —— 它就是浏览器,该到处导航
    //   我们开的弹窗(OAuth 那种)—— **也是浏览器**,登录流程要在里面连着跳好几次
    const isHost = () => contents === hostContents;

    // **护栏只管宿主界面。** 从前按「非 webview」判断,把我们自己开的 OAuth 弹窗
    // 一并拦了 —— 登录流程第一次重定向就被 preventDefault,弹窗停在一片空白,
    // 目标地址还被当成外链甩去开了个新标签。
    contents.on("will-navigate", (event, url) => {
      if (!isHost()) return;
      if (url.startsWith(hostOrigin) || url.startsWith("http://localhost:")) return;
      event.preventDefault();
      if (/^https?:/.test(url)) toRenderer("worktop:open-web-tab", { url });
      // mailto: / tel: 归系统。不处理的话它们会被 preventDefault 默默吃掉,点了没反应也不报错
      else if (/^[a-z][a-z0-9+.-]*:/i.test(url)) shell.openExternal(url).catch(() => {});
    });

    contents.setWindowOpenHandler(({ url, disposition }) => {
      if (!/^https?:/.test(url)) return { action: "deny" };
      if (isHost()) { shell.openExternal(url); return { action: "deny" }; }
      if (disposition === "new-window") {
        // **必须显式指定分区**:不指定的话弹窗用的是默认 session,
        // 登录流程在弹窗里种下的 cookie 落进另一个罐子,回到主标签就全丢了 ——
        // 表现和 Google 的 CookieMismatch 是同一类症状,而且更难查。
        return {
          action: "allow",
          overrideBrowserWindowOptions: {
            title: APP_NAME, // 不给的话标题退回 package.json 的 name(内部 slug),用户看到一个陌生的词
            webPreferences: { partition: WEB_PARTITION, contextIsolation: true, nodeIntegration: false },
          },
        };
      }
      // 带上来源和前/后台:Chrome 里 target=_blank 直接切过去,
      // 中键 / ⌘点击 是后台开、留在当前页。disposition 已经把这个区别告诉我们了。
      toRenderer("worktop:open-web-tab", {
        url,
        openerWcId: contents.id,
        background: disposition === "background-tab",
      });
      return { action: "deny" };
    });
  });
};

/**
 * 网页里的右键菜单。**此前完全没有** —— 复制图片、复制链接、在新标签打开、
 * 输入框里的剪切粘贴,这些肌肉记忆全部落空。
 *
 * 菜单用 Electron 原生 Menu 搭:输入框里的撤销/剪切/粘贴要拿到系统级的编辑
 * role 才真的能用,自绘的菜单做不到。
 */
const servePageMenu = () => {
  app.on("web-contents-created", (_event, contents) => {
    if (contents.getType() !== "webview") return;
    contents.on("context-menu", (_e, params) => {
      const win = BrowserWindow.getAllWindows()[0];
      const items = [];

      if (params.linkURL) {
        items.push(
          { label: "在新标签页打开链接", click: () => toRenderer("worktop:open-web-tab", { url: params.linkURL, openerWcId: contents.id, background: true }) },
          { label: "复制链接地址", click: () => clipboard.writeText(params.linkURL) },
          { type: "separator" },
        );
      }
      if (params.mediaType === "image" && params.srcURL) {
        items.push(
          { label: "复制图片", click: () => contents.copyImageAt(params.x, params.y) },
          { label: "复制图片地址", click: () => clipboard.writeText(params.srcURL) },
          { label: "在新标签页打开图片", click: () => toRenderer("worktop:open-web-tab", { url: params.srcURL, openerWcId: contents.id, background: true }) },
          { type: "separator" },
        );
      }
      if (params.isEditable) {
        items.push(
          { role: "undo", label: "撤销" }, { role: "redo", label: "重做" }, { type: "separator" },
          { role: "cut", label: "剪切" }, { role: "copy", label: "复制" },
          { role: "paste", label: "粘贴" }, { role: "selectAll", label: "全选" },
          { type: "separator" },
        );
      } else if (params.selectionText) {
        items.push({ role: "copy", label: "复制" }, { type: "separator" });
      }

      items.push(
        { label: "后退", enabled: contents.navigationHistory.canGoBack(), click: () => contents.navigationHistory.goBack() },
        { label: "前进", enabled: contents.navigationHistory.canGoForward(), click: () => contents.navigationHistory.goForward() },
        { label: "刷新", click: () => contents.reload() },
        { type: "separator" },
        { label: "复制页面地址", click: () => clipboard.writeText(contents.getURL()) },
        { label: "用系统浏览器打开", click: () => shell.openExternal(contents.getURL()).catch(() => {}) },
        { type: "separator" },
        { label: "检查元素", click: () => contents.inspectElement(params.x, params.y) },
      );
      Menu.buildFromTemplate(items).popup({ window: win || undefined });
    });
  });
};

/**
 * CDP 的对外面。渲染层拿着自己那个标签的 wcId 调进来 ——
 * `<webview>` 元素只有渲染进程摸得到,而 `webContents.debugger` 只有主进程摸得到,
 * 这一跳绕不开。谁拥有那个标签谁来调,和从前的 browser 工具一个口径。
 */
const serveCdp = () => {
  ipcMain.handle("worktop:cdp", async (_event, { wcId, op, params } = {}) => {
    try {
      const target = targetOf(wcId);
      switch (op) {
        case "snapshot": return { ok: true, data: await observe(target, params || {}) };
        case "act": return { ok: true, data: await act(target, params || {}) };
        case "eval": return { ok: true, data: await cdpEvaluate(target, String(params?.expression || "")) };
        case "raw": return { ok: true, data: await cdpSend(target, String(params?.method || ""), params?.params || {}) };
        default: return { ok: false, error: `不认识的 CDP 操作:${op}` };
      }
    } catch (error) {
      return { ok: false, error: String(error?.message || error) };
    }
  });
};

const createWindow = (port) => {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    // 跟系统深浅给窗口底色,避免深色用户开屏闪白(页面内联脚本随后定妆)
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#191919" : "#ffffff",
    title: APP_NAME,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: join(ROOT, "desktop/preload.cjs"), // 窄桥:仅暴露 installUpdate
      webviewTag: true, // 网页标签:界面里的 <webview>,真会话真登录态
      // 网页标签自己的 preload(AI 光标)要绝对 file:// 路径,渲染层拼不出打包后的位置,
      // 由壳算好从这里递过去
      additionalArguments: [`--webview-preload=file://${join(ROOT, "desktop/webviewPreload.cjs")}`],
    },
  });
  hostContents = win.webContents; // 立刻认领:导航护栏靠它区分宿主与我们开的弹窗
  // 更新在窗口加载前就绪(或刷新)时,补发一次「已就绪」给界面
  win.webContents.on("did-finish-load", () => {
    if (updateReadyVersion) broadcastUpdateReady(updateReadyVersion);
  });
  // 外部链接去系统浏览器,别在壳里迷路
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url) && !url.startsWith(`http://127.0.0.1:${port}`)) {
      shell.openExternal(url);
      return { action: "deny" };
    }
    return { action: "allow" };
  });
  win.loadURL(`http://127.0.0.1:${port}`);
  return win;
};

// ── 自动更新:electron-updater 打包在 desktop/updater.mjs(开发态没有,静默跳过)──
let updater = null;
let updateReadyVersion = null;
const broadcastUpdateReady = (version) => {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents
      .executeJavaScript(`window.dispatchEvent(new CustomEvent('worktop:update-ready',{detail:{version:${JSON.stringify(version)}}}))`)
      .catch(() => {});
  }
};
const setupUpdates = async () => {
  if (!app.isPackaged) return;
  try {
    const { setupUpdater } = await import("./updater.mjs");
    updater = setupUpdater({
      onReady: (version) => {
        updateReadyVersion = version;
        broadcastUpdateReady(version);
      },
    });
  } catch { /* 没打 updater 产物就不更新 */ }
};
ipcMain.handle("worktop:install-update", () => { updater?.install(); });

// ── 网页标签的 session:独立分区 ────────────────────────────────────────
// 网页标签用 persist:web,不与应用自身(127.0.0.1)共用 cookie 罐:
// 边界清楚,而且「退出所有网站」清得干净 —— 不会顺手清掉应用自己的东西。

ipcMain.handle("worktop:chrome-import-available", async () => {
  try {
    const { chromeImportAvailable } = await import("./chromeImport.mjs");
    return chromeImportAvailable();
  } catch { return false; }
});

// 导入 Chrome 登录态。只由界面上的明确点击触发 —— 取密钥时系统会弹钥匙串授权,
// 那是这个功能的安全闸门;用户拒绝则整次中止。
/**
 * 提取器跑在 Node 22 上 —— Electron 内置的 Node 20 没有 node:sqlite。
 * 脚本必须放在 asar 外面(extraResources):子进程是普通 Node,不认 asar。
 */
const extractorRuntime = () => (app.isPackaged
  ? { nodeBin: join(process.resourcesPath, "core/bin", NODE_BIN), script: join(process.resourcesPath, "core/chromeExtract.mjs") }
  : { nodeBin: "node", script: join(ROOT, "desktop/chromeExtract.mjs") });

ipcMain.handle("worktop:chrome-profiles", async () => {
  try {
    const { listChromeProfiles } = await import("./chromeImport.mjs");
    return { ok: true, profiles: await listChromeProfiles(extractorRuntime()) };
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
});

ipcMain.handle("worktop:import-chrome-cookies", async (_event, options) => {
  try {
    const { importChromeCookies } = await import("./chromeImport.mjs");
    return { ok: true, ...(await importChromeCookies(webSession(), extractorRuntime(), options || {})) };
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
});

// 退出所有网站:清 cookie 与站点数据(登录态没了,缓存留着)
ipcMain.handle("worktop:clear-web-logins", async () => {
  try {
    await webSession().clearStorageData({ storages: ["cookies", "localstorage", "indexdb", "websql", "serviceworkers"] });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
});

// 清缓存:腾磁盘,**不碰登录态**(两个动作分开,别让用户一按就退登)
ipcMain.handle("worktop:clear-web-cache", async () => {
  try {
    await webSession().clearCache();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
});

const checkUpdatesManually = async () => {
  if (!updater) {
    dialog.showMessageBox({ message: "开发模式不检查更新。" });
    return;
  }
  try {
    const result = await updater.checkNow();
    const latest = result?.updateInfo?.version;
    if (!latest || latest === app.getVersion()) {
      dialog.showMessageBox({ message: `已是最新版本(${app.getVersion()})。` });
    }
    // 有新版会自动后台下载,完成后应用内弹「重启更新」气泡
  } catch (error) {
    dialog.showErrorBox("检查更新失败", String(error?.message || error));
  }
};

// 网页标签里的 window.open / target=_blank:留在原地导航,不许弹窗乱飞
app.on("web-contents-created", (_event, contents) => {
  if (contents.getType() !== "webview") return;
  contents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) contents.loadURL(url);
    return { action: "deny" };
  });
});

// 应用菜单:⌘W 让给「关闭标签页」(转发进页面,渲染层关工作区标签),⌘⇧W 才关窗口。
// 无 preload/IPC 通道,用 executeJavaScript 派事件 —— 页面监听 worktop:close-tab。
const buildMenu = () => {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { role: "appMenu" },
    {
      label: "文件",
      submenu: [
        {
          label: "新建…",
          accelerator: "CmdOrCtrl+T",
          click: () => {
            BrowserWindow.getFocusedWindow()?.webContents
              .executeJavaScript("window.dispatchEvent(new Event('worktop:new-tab'))")
              .catch(() => {});
          },
        },
        { type: "separator" },
        {
          label: "关闭标签页",
          accelerator: "CmdOrCtrl+W",
          click: () => {
            BrowserWindow.getFocusedWindow()?.webContents
              .executeJavaScript("window.dispatchEvent(new Event('worktop:close-tab'))")
              .catch(() => {});
          },
        },
        { label: "关闭窗口", accelerator: "Shift+CmdOrCtrl+W", role: "close" },
        { type: "separator" },
        { label: "检查更新…", click: () => { void checkUpdatesManually(); } },
      ],
    },
    { role: "editMenu" },
    { role: "viewMenu" },
    { role: "windowMenu" },
  ]));
};

app.whenReady().then(async () => {
  try {
    buildMenu();
    const port = await pickPort();
    // 这两条必须在建窗口之前挂上 —— 它们监听 web-contents-created,
    // 晚一步的话第一个 webview 就漏过去了
    routeNewWindows(port);
    servePageMenu();
    // 网页分区的 UA 保持 Electron 原生串(带 Worktop/x 和 Electron/x)。
    // 试过改成纯 Chrome 串:Cloudflare Turnstile 会把"自称 Chrome 但指纹对不上"的判成异常,登录一律失败;
    // 请求头、navigator.userAgentData、window.chrome 全伪装过也不过。认到是 Electron 反而按嵌入式浏览器放行。
    // 权限 / 认证 / 证书:都挂在网页那个 session 上,和窗口无关,越早挂越好
    servePermissions(webSession(), toRenderer);
    serveHttpAuth(toRenderer);
    serveCertErrors(webSession(), toRenderer);
    serveDownloads(webSession(), toRenderer);
    serveAnswers();
    bindCursor();
    serveCdp();
    await startServer(port);
    createWindow(port);
    void setupUpdates();
    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow(port);
    });
  } catch (error) {
    dialog.showErrorBox(`${APP_NAME} 启动失败`, String(error?.message || error));
    app.quit();
  }
});

const stopChild = () => {
  quitting = true;
  if (child) {
    try { child.kill("SIGTERM"); } catch { /* 已退出 */ }
    child = null;
  }
};

app.on("before-quit", stopChild);
app.on("window-all-closed", () => {
  stopChild();
  app.quit();
});

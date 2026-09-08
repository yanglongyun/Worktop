// 预加载:渲染层与壳之间唯一的窄桥(contextIsolation 下的白名单 API)。
// 只暴露最少的能力,每一条都对应界面上一个明确的用户动作。
const { contextBridge, ipcRenderer } = require("electron");

const webviewPreload = (process.argv.find((a) => a.startsWith("--webview-preload=")) || "").slice("--webview-preload=".length);

contextBridge.exposeInMainWorld("worktopDesktop", {
  /** 网页标签要挂的 preload 路径(AI 光标)。壳算好,界面原样用。 */
  webviewPreload,

  /** 更新已下载后调用:退出并安装新版本。 */
  installUpdate: () => ipcRenderer.invoke("worktop:install-update"),
  /** 「关于」页的手动检查更新:结果由壳用系统对话框告知。 */
  checkUpdates: () => ipcRenderer.invoke("worktop:check-updates"),

  /** 这台机器能不能导入 Chrome 登录态(macOS + 装了 Chrome)。 */
  chromeImportAvailable: () => ipcRenderer.invoke("worktop:chrome-import-available"),
  /** 导入 Chrome 登录态 —— 必须由界面上的明确点击触发,系统会弹钥匙串授权。 */
  chromeProfiles: () => ipcRenderer.invoke("worktop:chrome-profiles"),
  importChromeCookies: (options) => ipcRenderer.invoke("worktop:import-chrome-cookies", options),
  /** 回答浏览器抛上来的问询(权限 / HTTP 认证)。 */
  answerWebPrompt: (id, value) => ipcRenderer.invoke("worktop:web-prompt-answer", { id, value }),
  /** 用户在证书警告上点了「仍要继续」:本次运行内信任这个域名。 */
  trustCertHost: (host) => ipcRenderer.invoke("worktop:web-trust-cert", host),
  /** 清空已授予的网站权限与证书例外。 */
  forgetWebPermissions: () => ipcRenderer.invoke("worktop:web-forget-permissions"),

  /** CDP:对某个网页标签做快照 / 原子操作 / 隔离世界执行。 */
  cdp: (wcId, op, params) => ipcRenderer.invoke("worktop:cdp", { wcId, op, params }),

  /** 下载:取消进行中的、在访达中显示、打开文件。 */
  cancelDownload: (id) => ipcRenderer.invoke("worktop:download-cancel", id),
  revealDownload: (path) => ipcRenderer.invoke("worktop:download-reveal", path),
  openDownload: (path) => ipcRenderer.invoke("worktop:download-open", path),

  /** 退出所有网站:清网页分区的 cookie 与站点数据。 */
  clearWebLogins: () => ipcRenderer.invoke("worktop:clear-web-logins"),
  /** 清缓存:腾磁盘,不影响登录态。 */
  clearWebCache: () => ipcRenderer.invoke("worktop:clear-web-cache"),
});

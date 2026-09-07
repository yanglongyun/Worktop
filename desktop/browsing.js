// 内置浏览器的三件基础能力:网站权限、HTTP 认证、证书出路。
//
// 三件都是「Electron 的默认值不对」而不是「我们少写了功能」:
//   权限 —— 默认**全放行**,任何网页不打招呼就能开麦克风摄像头。这是隐私洞,方向是收紧。
//   认证 —— 默认**不弹框**,带 Basic/Digest 认证的站是一片静默的 401,用户只会觉得坏了。
//   证书 —— 自签名/过期的站直接拦死,**没有任何出路**,内网系统和本地 https 服务全进不去。
//
// 单独成文件是因为这三件都挂在 session/app 上、都要和界面往返一次,
// 散进几百行的 main.js 里迟早被改漏。
import { app, ipcMain } from "electron";

/** 一定要问的:开硬件、要位置、常驻打扰。 */
const ASK = new Set(["media", "geolocation", "notifications", "midi", "midiSysex", "hid", "serial", "usb"]);

/** 无害的:页面自己的显示行为,问了反而是噪音。 */
const GRANT = new Set([
  "fullscreen", "pointerLock", "clipboard-sanitized-write",
  "idle-detection", "background-sync", "window-management",
]);

const decided = new Map(); // `${origin}|${permission}` → boolean
const pending = new Map(); // id → resolve
let seq = 0;

const originOf = (url) => { try { return new URL(url).origin; } catch { return ""; } };

/** 问界面一句,拿回答案。派不出去(窗口不在)就当拒绝 —— 没人能答的问题不该悬着。 */
const ask = (toRenderer, payload) => new Promise((resolve) => {
  const id = String((seq += 1));
  pending.set(id, resolve);
  if (!toRenderer(`worktop:${payload.kind}`, { ...payload, id })) {
    pending.delete(id);
    resolve(null);
  }
});

const settle = (id, value) => {
  const resolve = pending.get(String(id));
  if (!resolve) return false;
  pending.delete(String(id));
  resolve(value);
  return true;
};

// ── 网站权限 ────────────────────────────────────────────────────────────
export const servePermissions = (browsing, toRenderer) => {
  browsing.setPermissionRequestHandler(async (contents, permission, callback, details) => {
    if (GRANT.has(permission)) return callback(true);
    if (!ASK.has(permission)) return callback(false); // 不认识的一律拒,别默认放行
    const origin = originOf(details?.requestingUrl || contents?.getURL?.() || "");
    if (!origin) return callback(false);

    const key = `${origin}|${permission}`;
    if (decided.has(key)) return callback(decided.get(key));

    const answer = await ask(toRenderer, { kind: "web-permission", origin, permission });
    const allowed = answer === true;
    decided.set(key, allowed);
    callback(allowed);
  });

  // 同步检查走同一份决定:不接这个的话,页面用 navigator.permissions.query
  // 探到的状态和实际授权对不上,有些站会据此走进死路
  browsing.setPermissionCheckHandler((_contents, permission, requestingOrigin) => {
    if (GRANT.has(permission)) return true;
    return decided.get(`${requestingOrigin}|${permission}`) === true;
  });
};

/** 用户在设置里清空网站权限 —— 问过的重新问一遍。 */
const forgetPermissions = () => decided.clear();

// ── HTTP 认证(Basic / Digest)────────────────────────────────────────
export const serveHttpAuth = (toRenderer) => {
  app.on("login", (event, _contents, _details, authInfo, callback) => {
    event.preventDefault();
    void ask(toRenderer, {
      kind: "web-auth",
      // host 取自真正发起挑战的一方,界面必须显示它 —— 防止别的页面借道钓凭证
      host: String(authInfo.host || ""),
      realm: String(authInfo.realm || ""),
      isProxy: Boolean(authInfo.isProxy),
    }).then((answer) => {
      // 取消就让请求按 401 走,页面照常显示服务器的拒绝页
      if (!answer || !answer.username) return callback();
      callback(String(answer.username), String(answer.password || ""));
    });
  });
};

// ── 证书错误 ────────────────────────────────────────────────────────────
const trusted = new Set();

/**
 * **必须走 session 的 verifyProc,不能用 app 的 certificate-error** ——
 * 后者只管主窗口那层 webContents,webview 里的证书错误根本不从那条路过。
 */
export const serveCertErrors = (browsing, toRenderer) => {
  browsing.setCertificateVerifyProc((request, callback) => {
    // 0 = 用 Chromium 自己的判断(证书没问题时走这条)
    if (request.errorCode === 0 || request.verificationResult === "net::OK") return callback(0);
    if (trusted.has(request.hostname)) return callback(0);
    // -2 = 拒绝。先拦住,同时告诉界面;用户点「仍要继续」再放行并重载
    callback(-2);
    toRenderer("worktop:web-cert-error", { host: request.hostname, reason: request.verificationResult || "" });
  });
};

const trustCertHost = (host) => { if (host) trusted.add(String(host)); };
const forgetCertHosts = () => trusted.clear();

// ── 界面的回话口 ────────────────────────────────────────────────────────
export const serveAnswers = () => {
  ipcMain.handle("worktop:web-prompt-answer", (_event, payload) => settle(payload?.id, payload?.value));
  ipcMain.handle("worktop:web-trust-cert", (_event, host) => { trustCertHost(host); return true; });
  ipcMain.handle("worktop:web-forget-permissions", () => { forgetPermissions(); forgetCertHosts(); return true; });
};

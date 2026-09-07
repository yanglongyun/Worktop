// 同源门卫。server 只绑 127.0.0.1,但浏览器里**任意网页**都能向本机端口发 fetch / WebSocket ——
// 没有 Origin 校验的话,一个恶意网页就能通过你正跑着的 Worktop 执行 bash、读写磁盘。
// 所以 http 的写操作与 ws 升级都必须过这道门:只认应用自己发来的请求。
//
// 放行:
//   - 无 Origin 头 —— Electron 壳内页面、同源导航、curl 等非浏览器客户端(浏览器跨源 fetch 一定带 Origin);
//   - file:// —— 打包壳里的页面;
//   - http(s)://<回环主机>:<任意端口> —— 应用自己的前端,以及 dev 期 Vite 代理(5173 → 9506)。
// 拒绝:任何非回环 http(s) 源 —— 即公网/局域网的别的网站,恶意 RCE 的来源。
//
// 为什么回环放行到「任意端口」而非「仅自身端口」:真正的攻击者是公网网站(evil.com),
// 其 Origin 主机非回环,一定被拦;而本机另一个进程本就能开子进程、本就在信任边界内,
// 卡它的端口只徒增 dev 摩擦、不增安全。守住「必须是回环」这条线即可。

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);
const isLoopbackHost = (host: string) =>
  LOOPBACK_HOSTS.has(host) || host === "0.0.0.0" || host.endsWith(".localhost");

/**
 * 请求的 Host 头是否是回环 —— 防 DNS rebinding 的关键闸,且对 GET 也生效。
 *
 * Origin 门只挡跨源写;但 GET 不带同源保证,恶意网页可以把自己的域名 DNS 重绑到
 * 127.0.0.1,再用普通 fetch GET 读走对话/文件——那时 Host 头是攻击者的域名(evil.com:9506),
 * 而应用自己发的请求 Host 必是 127.0.0.1 / localhost。卡住 Host = 回环,这条路就断了。
 */
export const isTrustedHost = (host: unknown) => {
  const value = String(host || "").trim().toLowerCase();
  if (!value) return false; // 合法请求一定带 Host
  const hostname = value.startsWith("[")
    ? value.slice(0, value.indexOf("]") + 1)      // [::1]:9506 → [::1]
    : value.split(":")[0];                        // 127.0.0.1:9506 → 127.0.0.1
  return isLoopbackHost(hostname);
};

/** 请求的 Origin 是否可信(port 保留参数,当前策略只认「回环主机」不卡端口)。 */
export const isTrustedOrigin = (origin: unknown, _port?: number) => {
  const value = String(origin || "").trim();
  if (!value) return true; // 无 Origin 头:curl 等非浏览器客户端(浏览器跨源写一定带 Origin)
  // 字面 "null" = 不透明源(sandbox iframe / file://)。组件有自己的真 origin 且只走
  // 自己端口上的 /widgets/*,永远不会以 "null" 打到宿主端口上 —— 一律拒绝。
  if (value === "null") return false;
  let parsed;
  try { parsed = new URL(value); } catch { return false; }
  if (parsed.protocol === "file:") return true;
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
  return isLoopbackHost(parsed.hostname.toLowerCase());
};

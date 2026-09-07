// URL 的三种形态,全仓一份口径(浏览器同款):
//   规范形 —— 存储/请求用:无协议补 https://,URL 解析归一;
//   展示形 —— 界面用:隐藏 https:// 与尾斜杠(http:// 例外,异常要看得见);
//   身份键 —— 去重/聚焦用:主机去 www.、小写、忽略协议与尾斜杠 ——
//             www.google.com / https://google.com/ / http://Google.com 是同一个站。
const parseUrl = (raw: string): URL | null => {
  const value = String(raw || "").trim();
  if (!value) return null;
  try {
    return new URL(/^[a-z][a-z0-9+.-]*:/i.test(value) ? value : `https://${value}`);
  } catch { return null; }
};

/** 规范形:补协议后的完整 URL(非法原样返回)。 */
export const normalizeUrl = (raw: string): string => parseUrl(raw)?.toString() || String(raw || "").trim();

/** 展示形:去掉 https:// 与尾斜杠;http:// 保留。 */
export const displayUrl = (raw: string): string =>
  String(raw || "").replace(/^https:\/\//i, "").replace(/\/+$/, "") || String(raw || "");

/** 站点身份键:主机(去 www.、小写)+ 非默认端口。空串 = 解析失败。 */
export const hostKey = (raw: string): string => {
  const u = parseUrl(raw);
  if (!u) return "";
  return u.hostname.toLowerCase().replace(/^www\./, "") + (u.port ? `:${u.port}` : "");
};

/** 精确身份键:站点键 + 路径(去尾斜杠)+ query,忽略协议/www/hash。 */
export const exactKey = (raw: string): string => {
  const u = parseUrl(raw);
  if (!u) return String(raw || "").trim();
  return hostKey(raw) + u.pathname.replace(/\/+$/, "") + u.search;
};

/** 一段输入「长得像网址」吗(新标签页的意图判定:像 → 开网站,不像 → 开对话)。 */
export const looksLikeUrl = (raw: string): boolean => {
  const value = String(raw || "").trim();
  if (!value || /\s/.test(value)) return false;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) return true;          // 带协议
  if (/^localhost(:\d+)?([/?#]|$)/i.test(value)) return true;       // 本机
  return /^[\w-]+(\.[\w-]+)+([/?#]\S*)?$/.test(value);              // 域名形
};

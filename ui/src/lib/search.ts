// 搜索引擎:地址栏和新标签页里输了不像网址的东西,交给谁搜。
// 本机偏好,和外观一样存 localStorage,不进服务端设置。
import { looksLikeUrl, normalizeUrl } from "./urls";

export type SearchEngineId = "google" | "bing" | "baidu" | "duckduckgo";
export const SEARCH_ENGINES: { id: SearchEngineId; name: string; template: string }[] = [
  { id: "google", name: "Google", template: "https://www.google.com/search?q=%s" },
  { id: "bing", name: "Bing", template: "https://www.bing.com/search?q=%s" },
  { id: "baidu", name: "百度", template: "https://www.baidu.com/s?wd=%s" },
  { id: "duckduckgo", name: "DuckDuckGo", template: "https://duckduckgo.com/?q=%s" },
];
const KEY = "worktop.searchEngine";

export const getSearchEngine = () => {
  let id: string | null = null;
  try { id = localStorage.getItem(KEY); } catch { /* 隐私模式 */ }
  return SEARCH_ENGINES.find((e) => e.id === id) || SEARCH_ENGINES[0];
};
export const setSearchEngine = (id: SearchEngineId) => {
  try { localStorage.setItem(KEY, id); } catch { /* 隐私模式 */ }
};
const searchUrl = (query: string) => getSearchEngine().template.replace("%s", encodeURIComponent(query.trim()));

/** 地址栏的老规矩:像网址就当网址开,不像就拿去搜。 */
export const toNavigableUrl = (input: string): string => {
  const value = String(input || "").trim();
  if (!value) return "";
  return looksLikeUrl(value) ? normalizeUrl(value) : searchUrl(value);
};

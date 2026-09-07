// 会话列表「每行显示什么」。
//
// 逐项勾选而不是预设几档:一档一档试出来的东西,不如让人直接勾自己要的。
// 存 localStorage —— 这是本机的看法偏好,不是账号数据,不进服务端设置。
import { useEffect, useState } from "react";

export type ChatRowFields = {
  /** 最后一句人话(带「我 / 助手」前缀) */
  last: boolean;
  /** 相对时间 */
  time: boolean;
};

const KEY = "worktop.chatRows.fields";
const DEFAULTS: ChatRowFields = { last: true, time: true };
const EVENT = "worktop:chat-row-fields";

const read = (): ChatRowFields => {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULTS;
    return { ...DEFAULTS, ...(JSON.parse(raw) as Partial<ChatRowFields>) };
  } catch { return DEFAULTS; }
};

export const toggleChatRowField = (key: keyof ChatRowFields) => {
  const next = { ...read(), [key]: !read()[key] };
  try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* 隐私模式,只是本次不记住 */ }
  window.dispatchEvent(new CustomEvent(EVENT));
};

/** 订阅显示项。同窗口内多处(将来搜索面板也要)靠自定义事件对齐。 */
export const useChatRowFields = (): ChatRowFields => {
  const [fields, setFields] = useState(read);
  useEffect(() => {
    const sync = () => setFields(read());
    window.addEventListener(EVENT, sync);
    window.addEventListener("storage", sync); // 另一个窗口改了也跟上
    return () => {
      window.removeEventListener(EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);
  return fields;
};

/** 相对时间:今天给时刻,近一周给星期,再远给日期 —— 列表里没空间放完整时间戳。 */
export const relativeTime = (iso?: string | null): string => {
  if (!iso) return "";
  // SQLite 的 datetime('now') 是 UTC 且不带时区标记,补上 Z 再解析
  const d = new Date(/[Z+]|\d{2}:\d{2}$/.test(iso) ? iso : `${iso.replace(" ", "T")}Z`);
  const t = d.getTime();
  if (!Number.isFinite(t)) return "";
  const mins = Math.floor((Date.now() - t) / 60000);
  if (mins < 1) return "刚刚";
  if (mins < 60) return `${mins} 分钟前`;
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  if (sameDay) return d.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false });
  const days = Math.floor((mins / 60) / 24);
  if (days < 1) return "昨天";
  if (days < 7) return d.toLocaleDateString("zh-CN", { weekday: "short" });
  return d.toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" });
};

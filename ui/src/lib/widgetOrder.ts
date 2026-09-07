// 「小组件」面板里格子的顺序(装了就显示,没有钉选)。
//
// 侧栏活动栏与组件管理页都要读它,放这里当唯一事实源,改动经 window 事件广播。
// 存的是 id 列表:在列表里的按列表序,不在的(新装的)按服务端序排在后面。
import { useEffect, useState } from "react";

const KEY = "worktop.widgets.order";
const EVENT = "worktop:widget-order-changed";

const readOrder = (): string[] => {
  try {
    const raw = localStorage.getItem(KEY);
    const value = raw == null ? null : JSON.parse(raw);
    return Array.isArray(value) ? value.filter((id) => typeof id === "string") : [];
  } catch { return []; }
};

export const writeOrder = (ids: string[]) => {
  try { localStorage.setItem(KEY, JSON.stringify(ids)); } catch { /* 隐私模式:本次会话内仍然生效 */ }
  window.dispatchEvent(new CustomEvent(EVENT, { detail: { ids } }));
};

/** 组件被删掉时把它从顺序里摘掉。 */
export const dropFromOrder = (id: string) => {
  const current = readOrder();
  if (current.includes(id)) writeOrder(current.filter((x) => x !== id));
};

/** 按存好的顺序排一遍:在列表里的靠前,不在的保持传入顺序垫后。 */
export const applyOrder = <T extends { id: string }>(items: T[]): T[] => {
  const order = readOrder();
  const at = (id: string) => { const i = order.indexOf(id); return i === -1 ? order.length : i; };
  return [...items].sort((a, b) => at(a.id) - at(b.id));
};

/** 订阅式读取:任何一处改动,所有在看的界面同步更新。 */
export const useWidgetOrder = (): string[] => {
  const [order, setOrder] = useState<string[]>(readOrder);
  useEffect(() => {
    const sync = () => setOrder(readOrder());
    window.addEventListener(EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);
  return order;
};

/** 「让 AI 造一个组件」:动作住在 PanelHost(要开对话、发提示词),管理页只管喊一声。 */
export const CREATE_WIDGET_EVENT = "worktop:create-widget";
export const requestCreateWidget = () => window.dispatchEvent(new Event(CREATE_WIDGET_EVENT));

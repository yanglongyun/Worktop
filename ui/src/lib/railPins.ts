// 固定到活动栏的东西:应用、网站、小组件。
//
// 存在本机(localStorage),和组件顺序一个路数;改动经 window 事件广播,活动栏和各面板的菜单同步。
import { useEffect, useState } from "react";

export type RailPin = {
  kind: "app" | "site" | "widget";
  id: string;
  title: string;
  /** 网站:地址;小组件:emoji 图标;应用:有没有 icon.svg。 */
  url?: string;
  icon?: string;
  hasIcon?: boolean;
};

const KEY = "worktop.rail.pins";
const EVENT = "worktop:rail-pins-changed";

// 第一次打开时活动栏不该是空的:预装的应用和小组件先固定几个,让人知道这一栏是干什么的。
// 用户取消固定就写回空数组,以后不再补。
const DEFAULT_PINS: RailPin[] = [
  { kind: "app", id: "notes", title: "笔记", hasIcon: true },
  { kind: "app", id: "ramify", title: "创意", hasIcon: true },
  { kind: "widget", id: "todo", title: "待办", icon: "✅" },
  { kind: "widget", id: "notes", title: "便签", icon: "📌" },
];

const readPins = (): RailPin[] => {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw == null) return DEFAULT_PINS;
    const value = JSON.parse(raw);
    return Array.isArray(value) ? value.filter((p) => p && typeof p.id === "string" && typeof p.kind === "string") : [];
  } catch { return []; }
};

const writePins = (pins: RailPin[]) => {
  try { localStorage.setItem(KEY, JSON.stringify(pins)); } catch { /* 隐私模式:本次会话内仍然生效 */ }
  window.dispatchEvent(new CustomEvent(EVENT, { detail: { pins } }));
};

export const isPinned = (kind: RailPin["kind"], id: string) => readPins().some((p) => p.kind === kind && p.id === id);

/** 固定 / 取消固定,返回操作后是否固定。 */
export const togglePin = (pin: RailPin): boolean => {
  const current = readPins();
  if (current.some((p) => p.kind === pin.kind && p.id === pin.id)) {
    writePins(current.filter((p) => !(p.kind === pin.kind && p.id === pin.id)));
    return false;
  }
  writePins([...current, pin]);
  return true;
};

export const unpin = (kind: RailPin["kind"], id: string) => {
  const current = readPins();
  if (current.some((p) => p.kind === kind && p.id === id)) writePins(current.filter((p) => !(p.kind === kind && p.id === id)));
};

/** 订阅式读取:任何一处改动,所有在看的界面同步更新。 */
export const useRailPins = (): RailPin[] => {
  const [pins, setPins] = useState<RailPin[]>(readPins);
  useEffect(() => {
    const sync = () => setPins(readPins());
    window.addEventListener(EVENT, sync);
    window.addEventListener("storage", sync);
    return () => { window.removeEventListener(EVENT, sync); window.removeEventListener("storage", sync); };
  }, []);
  return pins;
};

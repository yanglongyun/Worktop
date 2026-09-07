import { useState } from "react";
import { api, type Node } from "../../../api";
import { dialog } from "../../ui";
import { beginGlobalDrag, endGlobalDrag } from "../../../lib/drag";
import {
  PointerSensor,
  TouchSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  type DragStartEvent,
  type DragOverEvent,
  type DragEndEvent,
} from "@dnd-kit/core";

export const ROOT_ID = "__root__";

// 树的拖拽:sensors + 目标目录判定 + 落库,全部内聚在此。
//
// 文件树没有手工排序(磁盘目录按名列出),
// 所以这里不存在 before/after 插入线 —— 拖拽唯一的语义是「搬进某个文件夹」:
//   - 悬停文件夹 = 搬进它;悬停文件 = 搬进它所在的文件夹;
//   - 目标目录整行亮起(.drop-target);目标就是拖拽物当前所在目录 → 不亮、放下也不动;
//   - 多选拖拽整组搬(祖先已选中的后代剔除,id 即绝对路径)。
export function useTreeDnd({
  refresh,
  setExpanded,
  getSelection,
}: {
  refresh: () => void;
  setExpanded: (id: string, on: boolean) => void;
  /** 多选拖拽:返回当前多选 id 集(拖的是选中项之一时,整组一起搬)。 */
  getSelection?: () => string[];
}) {
  const [activeNode, setActiveNode] = useState<Node | null>(null);
  const activeId = activeNode?.id || null;
  /** 当前会被落入的目标目录 id(null = 没有可行目标,不亮)。 */
  const [overDirId, setOverDirId] = useState<string | null>(null);

  // ── sensors:鼠标 + 触摸 + 键盘 ──
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
    useSensor(KeyboardSensor),
  );

  /** 本次拖拽实际要搬的一组 id:多选含拖拽物 → 整组;剔除「祖先也被选中」的后代。 */
  const dragBatch = (src: string) => {
    const selection = getSelection?.() || [];
    let batch = selection.length > 1 && selection.includes(src) ? selection : [src];
    batch = batch.filter((id) => !batch.some((other) => other !== id && id.startsWith(other + "/")));
    return batch;
  };

  const parentOf = (id: string) => id.slice(0, id.lastIndexOf("/"));

  /** id 能否搬进 dirId:不进自己/自己的子孙,不搬回自己当前所在目录(原地 = 无操作)。 */
  const movableInto = (id: string, dirId: string) =>
    dirId !== id && !dirId.startsWith(id + "/") && parentOf(id) !== dirId;

  /** 悬停节点 → 目标目录:文件夹是它自己,文件是它所在的文件夹。 */
  const targetDirOf = (node: Node) => (node.kind === "space" ? node.id : node.parent_id || null);

  /** 移动 + 重名覆盖确认:服务端默认拒绝同名,确认后带 overwrite 重试(旧的进废纸篓)。 */
  const moveWithConfirm = async (sourceId: string, dirId: string) => {
    try {
      await api.moveNode(sourceId, dirId);
    } catch (e: any) {
      if (/已有同名/.test(e?.message || "")) {
        if (await dialog.confirm(`${e.message}。覆盖吗?(被覆盖的会进废纸篓)`, { danger: true, confirmText: "覆盖" })) {
          await api.moveNode(sourceId, dirId, true);
        }
      } else throw e;
    }
  };

  // ── dnd-kit 事件 ──
  const onDragStart = (e: DragStartEvent) => {
    beginGlobalDrag(); // webview/iframe 失明,end/cancel 恢复
    const node = (e.active.data.current as any)?.node as Node | undefined;
    if (node) setActiveNode(node);
  };

  const onDragOver = (e: DragOverEvent) => {
    const over = e.over;
    if (!over || String(over.id) === ROOT_ID || !activeId) { setOverDirId(null); return; }
    const node = (over.data.current as any)?.node as Node | undefined;
    if (!node) { setOverDirId(null); return; }
    const dirId = targetDirOf(node);
    if (!dirId) { setOverDirId(null); return; }
    // 整组里至少有一个真会动,目标才亮;全是原地/进自己 → 不亮
    const movable = dragBatch(activeId).some((id) => movableInto(id, dirId));
    setOverDirId(movable ? dirId : null);
  };

  const onDragEnd = async (_e: DragEndEvent) => {
    endGlobalDrag();
    const src = activeId;
    const dirId = overDirId;
    setActiveNode(null);
    setOverDirId(null);
    if (!src || !dirId) return;

    const batch = dragBatch(src).filter((id) => movableInto(id, dirId));
    if (!batch.length) return;
    for (const id of batch) {
      try {
        await moveWithConfirm(id, dirId);
      } catch (e: any) {
        void dialog.alert(e?.message || "移动失败");
      }
    }
    setExpanded(dirId, true); // 放下即展开,看得见落点
    refresh();
  };

  const onDragCancel = () => {
    endGlobalDrag();
    setActiveNode(null);
    setOverDirId(null);
  };

  return {
    sensors,
    activeNode,
    overDirId,
    dndHandlers: { onDragStart, onDragOver, onDragEnd, onDragCancel },
  };
}

// 树服务:repo 之上的业务层 —— 负责事件广播(tree_changed)+ 把 update+move 收拢。
// 树上只有文件夹和文件;对话在 service/chats.ts。
import * as repo from "./tree.js";
import * as roots from "./roots.js";
import { emit } from "../bus.js";

// 注:repo/tree.ts 尚未脱 @ts-nocheck,推断签名过窄;边界处以 as any 收口,repo 脱敏后移除。
const listChildren = (parentId?: string | null) => repo.listChildren(parentId || null);
const listAll = () => repo.listAll();
const getItem = (id: string) => repo.getItem(id);

const create = ({ kind, parentId = null, title = "", content = null }: { kind?: string; parentId?: string | null; title?: string; content?: string | null } = {}) => {
  const item = repo.createItem({ kind: kind || "folder", parentId: parentId || null, title, content } as any);
  emit({ type: "tree_changed", item, reason: "created" });
  return item;
};

// 改名/改内容 + 移动(都可选),最后返回最新项;overwrite 透传给重名守卫
const update = (id: string, { title, content, parentId, overwrite }: { title?: string; content?: string | null; parentId?: string | null; overwrite?: boolean } = {}) => {
  let moved = null;
  if (title !== undefined || content !== undefined) {
    moved = repo.updateItem(id, { title, content, overwrite } as any);
  }
  if (parentId !== undefined) {
    const currentId = moved?.id || id; // 改名后 id(路径)已变
    moved = repo.moveItem(currentId, parentId, overwrite);
  }
  const item = getItem(moved?.id || id);
  emit({ type: "tree_changed", item, reason: "updated" });
  return item;
};

const importFile = (body: { parentId?: string | null; relPath?: string; dataBase64?: string } = {}) => {
  const item = repo.importFile(body as any);
  emit({ type: "tree_changed", item, reason: "imported" });
  return item;
};

const remove = (id: string) => {
  repo.deleteItem(id);
  emit({ type: "tree_changed", id, reason: "deleted" });
};

const copy = (id: string, targetParentId: string | null = null) => {
  const item = repo.copyItem(id, targetParentId as any);
  emit({ type: "tree_changed", item, reason: "copied" });
  return item;
};

const listRoots = () => roots.listRoots();

const addRoot = (body: { path?: string; title?: string } = {}) => {
  const item = repo.getItem(roots.addRoot(body));
  emit({ type: "tree_changed", item, reason: "root_added" });
  return item;
};

const removeRoot = (id: string) => {
  const fileRoot = roots.removeRoot(id);
  emit({ type: "tree_changed", id, reason: "root_removed" });
  return fileRoot;
};

const fileRawAbs = (id: string) => repo.resolveFileAbs(id);
const pathForId = (id: string) => repo.pathForId(id);

export { listChildren, listAll, getItem, create, update, remove, copy, importFile, fileRawAbs, pathForId, listRoots, addRoot, removeRoot };

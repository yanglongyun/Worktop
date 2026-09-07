import { browserApi } from "../api/browser";
// 「从浏览器导入」的共享状态与调用。
//
// 三个地方都要用它、且必须口径一致:网页标签顶部的引导条、⋯ 菜单、设置页。
// 导入过或用户主动关掉过,引导条就不再出现 —— 但菜单和设置页的入口永远在
// (换了 Chrome 账号、cookie 过期,都需要能再导一次)。

const STATE_KEY = "worktop.chromeImport.state";

export type ChromeProfile = { dir: string; name: string; email: string };
export type ImportChoice = { profile: string; cookies: boolean; bookmarks: boolean; passwords: boolean };
export type ImportResult = { profile: string; total: number; imported: number; failed: number; bookmarks: number; folders: number; passwords: number };

const read = () => {
  try { return localStorage.getItem(STATE_KEY) || ""; } catch { return ""; }
};
const write = (value: string) => {
  try { localStorage.setItem(STATE_KEY, value); } catch { /* 隐私模式下写不进,不拦流程 */ }
};

/** 引导条该不该出现:没导过、没关过,才提示。 */
export const shouldPromptImport = () => !read();
const markImported = () => write("done");
export const dismissImportPrompt = () => write("dismissed");

/** 这台机器能不能导(macOS + 装了 Chrome);非桌面壳一律 false。 */
export const chromeImportAvailable = async () => {
  try { return (await window.worktopDesktop?.chromeImportAvailable()) === true; } catch { return false; }
};

/** 列出可选的 Chrome 配置。取不到就返回空数组,由界面退化成「不用选」。 */
export const listChromeProfiles = async (): Promise<ChromeProfile[]> => {
  try {
    const result = await window.worktopDesktop?.chromeProfiles();
    return result?.ok ? result.profiles : [];
  } catch { return []; }
};

/**
 * 导入。cookie 由壳直接注入 session;书签落「网站」面板 ——
 * 主进程不认识产品的 HTTP API,所以这一步在界面这边做。
 */
export const importFromChrome = async (choice: ImportChoice): Promise<ImportResult> => {
  const bridge = window.worktopDesktop;
  if (!bridge) throw new Error("需要在桌面应用里使用");
  const result = await bridge.importChromeCookies(choice);
  if (!result.ok) throw new Error(result.error);

  // 去重在服务端:同一个 url 已收藏就返回那一行、不插入。这里只负责数对(返回的 id 导入前就有 = 不算新增)。
  // 文件夹:同一层里同名的复用 —— 再导一次不会多出一份「书签栏」。
  let bookmarks = 0, folders = 0;
  if (choice.bookmarks && result.bookmarks.length) {
    const existing = await browserApi.listBookmarks().catch(() => []);
    const before = new Set(existing.map((site) => site.id));
    const added = new Set<string>();
    const folderAt = new Map<string, string>(); // `${parent}\u0000${title}` → id
    for (const site of existing) if (site.kind === "folder") folderAt.set(`${site.parent_id || ""}\u0000${site.title}`, site.id);
    const walk = async (nodes: { title: string; url?: string; children?: any[] }[], parentId: string | null) => {
      for (const node of nodes) {
        try {
          if (node.children) {
            const key = `${parentId || ""}\u0000${node.title}`;
            let id = folderAt.get(key);
            if (!id) {
              const folder = await browserApi.createBookmarkFolder({ title: node.title, parentId });
              id = folder.id; folderAt.set(key, id); folders += 1;
            }
            await walk(node.children, id);
          } else if (node.url) {
            const site = await browserApi.createBookmark({ title: node.title, url: node.url, parentId });
            if (!site || before.has(site.id) || added.has(site.id)) continue;
            added.add(site.id);
            bookmarks += 1;
          }
        } catch { /* 单条失败跳过,不因为一条坏书签毁掉整次导入 */ }
      }
    };
    await walk(result.bookmarks, null);
  }

  // 密码:交给宿主加密落库,服务端按 host+账号+密码 去重
  let passwordsAdded = 0;
  if (choice.passwords && result.passwords?.length) {
    try { passwordsAdded = await browserApi.importPasswords(result.passwords); } catch { /* 钥匙串拿不到时导不了,界面会看到 0 */ }
  }

  markImported();
  return { profile: result.profile, total: result.total, imported: result.imported, failed: result.failed, bookmarks, folders, passwords: passwordsAdded };
};

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, realpathSync, existsSync, rmSync } from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";

test("主界面、应用和小组件使用各自的路由", async (t) => {
  const home = realpathSync(mkdtempSync(path.join(os.tmpdir(), "worktop-routes-")));
  process.env.WORKTOP_HOME = path.join(home, "data");
  process.env.WORKTOP_PRODUCT_HOME = path.join(home, "product");
  const fixture = (kind: string, id: string, permissions: string[]) => {
    const dir = path.join(process.env.WORKTOP_PRODUCT_HOME!, kind, id);
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, "index.html"), "<!doctype html><p>route fixture</p>");
    writeFileSync(path.join(dir, kind === "apps" ? "manifest.json" : "widget.json"), JSON.stringify({ id, name: id, permissions }));
  };
  fixture("apps", "app-one", ["notify", "ai.complete", "ai.agent"]);
  fixture("apps", "app-denied", []);
  fixture("widgets", "widget-one", ["sql", "ai", "net"]);
  fixture("widgets", "widget-two", ["sql"]);
  fixture("widgets", "widget-denied", []);
  const skillDir = path.join(process.env.WORKTOP_PRODUCT_HOME!, "skills", "route-skill");
  mkdirSync(skillDir, { recursive: true });
  writeFileSync(path.join(skillDir, "SKILL.md"), "# Route skill\n\nA fixture skill.");

  const { handleApi } = await import("../server/http/api/index.js");
  const { ensureApp, stopAllApps } = await import("../server/apps/supervisor.js");
  const { widgetSitePort, closeWidgetSite } = await import("../server/widgets/site.js");
  const { closeWidgetDb } = await import("../server/widgets/db.js");
  const { getDb } = await import("../server/database/connection.js");
  const { setBroadcaster } = await import("../server/bus.js");
  const events: any[] = [];
  setBroadcaster((event: any) => {
    events.push(event);
    if (event.type === "widget_confirm") void request(origin, "/api/widgets/confirm/result", { requestId: event.requestId, ok: true });
  });
  const server = http.createServer((req, res) => {
    void handleApi(req, res).then((handled) => {
      if (handled === null) { res.writeHead(404); res.end("no API route"); }
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const origin = `http://127.0.0.1:${(server.address() as import("node:net").AddressInfo).port}`;
  const request = (base: string, route: string, body?: object, token?: string) => fetch(base + route, {
    method: body ? "POST" : "GET",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  t.after(async () => {
    for (const id of ["widget-one", "widget-two", "widget-denied"]) { closeWidgetSite(id); closeWidgetDb(id); }
    await stopAllApps();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    getDb().close();
    rmSync(home, { recursive: true, force: true });
  });
  const allowed = await ensureApp("app-one");
  const denied = await ensureApp("app-denied");
  const widgetOrigin = `http://127.0.0.1:${await widgetSitePort("widget-one")}`;
  const widgetTwo = `http://127.0.0.1:${await widgetSitePort("widget-two")}`;
  const widgetDenied = `http://127.0.0.1:${await widgetSitePort("widget-denied")}`;

  await t.test("数据库按领域命名，核心四表保持独立契约", () => {
    const tables = getDb().prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all().map((r: any) => r.name).sort();
    assert.deepEqual(tables, ["chats", "messages", "compactions", "tasks", "settings", "file_roots", "browser_bookmarks", "browser_history", "browser_passwords", "settings_rules"].sort());
  });
  await t.test("主界面管理接口保持 /api", async () => {
    for (const route of ["/health", "/api/settings", "/api/settings/rules", "/api/apps", "/api/apps/tasks", "/api/widgets", "/api/widgets/sites", "/api/skills", "/api/chats", "/api/chats/runs", "/api/files/roots", "/api/files/tree", "/api/browser/bookmarks", "/api/browser/history", "/api/browser/passwords", "/api/git/status"]) {
      assert.equal((await request(origin, route)).status, 200);
    }
    assert.equal((await request(origin, "/widgets/context")).status, 404);
  });
  const call = async (route: string, method = "GET", body?: object, expected = 200) => {
    const response = await fetch(origin + route, {
      method,
      headers: { "Content-Type": "application/json" },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const value = await response.json();
    assert.equal(response.status, expected, `${method} ${route}: ${JSON.stringify(value)}`);
    return value;
  };
  await t.test("对话消息、确认与规则按归属工作", async (t) => {
    const { item } = await call("/api/chats", "POST", { title: "route chat" }, 201);
    t.after(() => call(`/api/chats?id=${item.id}`, "DELETE"));
    assert.equal(item.kind, "chat");
    assert.equal("parent_id" in item, false);
    assert.equal("content" in item, false);
    const { appendItem } = await import("../server/chats/messages.js");
    appendItem(item.id, { role: "user", content: "hello" });
    assert.equal((await call(`/api/chats/messages?chatId=${item.id}`)).rows[0].item.content, "hello");
    assert.equal((await call(`/api/chats/get?id=${item.id}`)).item.title, "route chat");
    assert.equal((await call(`/api/chats?id=${item.id}`, "PATCH", { pinned: true })).item.pinned, true);
    assert.ok((await call(`/api/chats/read?id=${item.id}`, "POST")).item.last_read_at);
    const { requestConfirm } = await import("../server/chats/approvals.js");
    const controller = new AbortController();
    t.after(() => controller.abort());
    const answer = requestConfirm({ chatId: item.id, summary: "check", detail: "fixture", risk: "none", signal: controller.signal });
    const approvals = (await call(`/api/chats/approvals?chatId=${item.id}`)).approvals;
    assert.equal(approvals.length, 1);
    assert.equal((await call("/api/chats/approvals", "POST", { id: approvals[0].id, answer: "allow" })).ok, true);
    assert.equal(await answer, "allow");
    const { rule } = await call("/api/settings/rules", "POST", { text: "test rule" }, 201);
    assert.equal((await call(`/api/settings/rules?id=${rule.id}`, "PATCH", { enabled: false })).rule.enabled, false);
    await call("/api/settings/rules", "PATCH", { id: rule.id, enabled: true }, 404);
    const rules = (await call("/api/settings/rules")).rules;
    await call("/api/settings/rules/order", "POST", { ids: rules.map((r: any) => r.id).reverse() });
    await call(`/api/settings/rules?id=${rule.id}`, "DELETE");
  });
  await t.test("常用根目录、文件编辑、HTML 资源与附件不串路由", async (t) => {
    const folder = path.join(home, "files fixture");
    mkdirSync(folder);
    const { item } = await call("/api/files/roots", "POST", { path: folder }, 201);
    t.after(() => call(`/api/files/roots?id=${encodeURIComponent(folder)}`, "DELETE"));
    assert.equal(item.isRoot, true);
    assert.equal(item.kind, "folder");
    assert.equal("system" in item, false);
    assert.equal("last_read_at" in item, false);
    assert.equal("content" in item, false);
    assert.equal("workspace" in item, false);
    const roots = await call("/api/files/roots");
    assert.equal(roots.roots[0].path, folder);
    assert.equal("workspaces" in roots, false);
    await call("/api/files/tree", "POST", { kind: "file", parentId: folder, title: "index.html", content: '<link rel="stylesheet" href="style.css">hello' }, 201);
    const imported = await call("/api/files/tree/import", "POST", { parentId: folder, relPath: "style.css", dataBase64: Buffer.from("body{color:red}").toString("base64") }, 201);
    const id = encodeURIComponent(imported.item.id);
    assert.equal((await call(`/api/files/tree/get?id=${id}`)).item.content, "body{color:red}");
    await call(`/api/files/tree/get?id=${id}`, "POST", {}, 404);
    const htmlUrl = origin + "/api/files/local" + encodeURI(path.join(folder, "index.html"));
    assert.match(await (await fetch(htmlUrl)).text(), /hello/);
    assert.equal(await (await fetch(new URL("style.css", htmlUrl))).text(), "body{color:red}");
    assert.equal(await (await fetch(origin + `/api/files/raw?id=${id}`)).text(), "body{color:red}");
    await call(`/api/files/tree?id=${id}`, "PATCH", { content: "changed" });
    assert.equal(readFileSync(imported.item.id, "utf8"), "changed");
    const copy = await call("/api/files/tree/copy", "POST", { id: imported.item.id }, 201);
    assert.equal(readFileSync(copy.item.id, "utf8"), "changed");
    assert.equal((await call(`/api/files/tree?parentId=${encodeURIComponent(folder)}`)).items.length, 3);
    assert.ok((await call("/api/files/tree/all")).items.some((n: any) => n.id === copy.item.id));
    const uploaded = await call("/api/files/upload", "POST", { name: "fixture.txt", mimeType: "text/plain", dataBase64: Buffer.from("attachment").toString("base64") }, 201);
    assert.match(uploaded.attachment.url, /^\/api\/files\/attachments\//);
    assert.equal(await (await fetch(origin + uploaded.attachment.url)).text(), "attachment");
    // Removing the root only removes its bookmark, never its disk content.
    const removed = await call(`/api/files/roots?id=${encodeURIComponent(folder)}`, "DELETE");
    assert.equal(removed.root.path, folder);
    assert.equal(existsSync(imported.item.id), true);
  });
  await t.test("附件存储与模型输入转换拆分后保持语义", async () => {
    const { upload, normalizeMany } = await import("../server/files/attachments.js");
    const { prepareInput } = await import("../server/chats/input.js");
    const image = upload({ name: "fixture.png", mimeType: "image/png", dataBase64: Buffer.from("image fixture").toString("base64") });
    assert.ok(image);
    assert.deepEqual(normalizeMany([image]), [image]);
    const rows = [
      { role: "user", content: "previous", attachments: [image] },
      { role: "user", content: "current", attachments: [image] },
      { type: "function_call_output", call_id: "tool-image", output: "done", image },
    ];
    const output = await prepareInput(rows);
    assert.equal("attachments" in output[0], false);
    assert.equal(output[1].content[0].text, "current");
    assert.match(output[1].content[1].image_url, /^data:image\/png;base64,/);
    assert.equal(output[2].output[1].type, "input_image");
    assert.equal(rows[0].attachments?.length, 1);
  });
  await t.test("收藏、历史与设置子资源不会被模块入口吞掉", async () => {
    const folder = await call("/api/browser/bookmarks/folder", "POST", { title: "folder" }, 201);
    const bookmark = await call("/api/browser/bookmarks", "POST", { url: "https://example.com", title: "Example", parentId: folder.item.id }, 201);
    const listed = await call("/api/browser/bookmarks");
    assert.equal(listed.bookmarks.length, 2);
    assert.equal("sites" in listed, false);
    await call(`/api/browser/bookmarks?id=${bookmark.item.id}`, "PATCH", { title: "renamed" });
    const reordered = await call("/api/browser/bookmarks/order", "POST", { parentId: null, ids: [bookmark.item.id, folder.item.id] });
    assert.equal(reordered.bookmarks.find((b: any) => b.id === bookmark.item.id).parent_id, null);
    await call(`/api/browser/bookmarks?id=${bookmark.item.id}`, "DELETE");
    await call(`/api/browser/bookmarks?id=${folder.item.id}`, "DELETE");
    await call("/api/browser/history/visit", "POST", { url: "https://example.com", title: "Example" });
    assert.equal((await call("/api/browser/history?q=Example")).history.length, 1);
    await call("/api/browser/history?all=1", "DELETE");
    const settings = await call("/api/settings");
    assert.ok(settings.promptDefaults.system);
    await call("/api/settings", "POST", { compressThreshold: "64000" });
    assert.equal((await call("/api/settings")).settings.compressThreshold, "64000");
    // Missing password paths validate dispatch without reading or creating a keychain secret.
    await call("/api/browser/passwords/reveal?id=missing", "GET", undefined, 404);
    await call("/api/skills/toggle", "POST", { id: "route-skill", enabled: false });
    assert.equal((await call("/api/skills")).skills[0].enabled, false);
    assert.match((await call("/api/skills/doc?id=route-skill")).content, /Route skill/);
    await call("/api/system/reveal?id=missing", "POST", undefined, 404);
  });
  await t.test("Git 差异与暂存使用当前字段", async (t) => {
    const folder = path.join(home, "git fixture");
    mkdirSync(folder);
    execFileSync("git", ["init", "-q", folder]);
    const git = (...args: string[]) => execFileSync("git", ["-C", folder, ...args], { encoding: "utf8" });
    git("config", "user.name", "Route Test");
    git("config", "user.email", "test@example.invalid");
    writeFileSync(path.join(folder, "test.txt"), "before\n");
    git("add", "test.txt");
    git("-c", "commit.gpgsign=false", "commit", "-qm", "fixture");
    writeFileSync(path.join(folder, "test.txt"), "after\n");
    await call("/api/files/roots", "POST", { path: folder }, 201);
    t.after(() => call(`/api/files/roots?id=${encodeURIComponent(folder)}`, "DELETE"));
    const query = `root=${encodeURIComponent(folder)}&path=test.txt`;
    const diff = await call(`/api/git/diff?${query}`);
    assert.equal(diff.before, "before");
    assert.equal(diff.after, "after");
    const staged = await call("/api/git/stage", "POST", { root: folder, path: "test.txt" });
    assert.equal(staged.repository.fileRootPath, folder);
    assert.equal(staged.repository.files[0].staged, true);
    const unstaged = await call("/api/git/unstage", "POST", { root: folder, path: "test.txt" });
    assert.equal(unstaged.repository.files[0].staged, false);
    await call("/api/git/discard", "POST", { root: folder, path: "test.txt" });
    assert.equal(readFileSync(path.join(folder, "test.txt"), "utf8"), "before\n");
  });
  await t.test("未知模块、旧路径与错误方法没有备用入口", async () => {
    for (const route of ["/api/constructor", "/api/__proto__", "/api/files/nope", "/api/tree", "/api/workspaces", "/api/messages", "/api/runs", "/api/sites", "/api/history", "/api/passwords", "/api/rules", "/api/approvals", "/api/tasks", "/api/favicon", "/api/file/raw", "/api/fs/test", "/api/files/unknown-id", "/api/git/file-pair"]) {
      await call(route, "GET", undefined, 404);
    }
    for (const route of ["/api/upload", "/api/reveal", "/api/workspaces/pick", "/api/widgets/confirm-result"]) await call(route, "POST", {}, 404);
    await call("/api/system/directory/pick", "GET", undefined, 404);
    await call("/api/apps/stop?id=app-one", "POST", {}, 404);
  });
  await t.test("应用身份、权限、通知与模型路由", async () => {
    assert.equal((await request(origin, "/apps/me")).status, 401);
    assert.equal((await (await request(origin, "/apps/me", undefined, allowed.token)).json()).appId, "app-one");
    assert.equal((await request(origin, "/apps/notify", { text: "test" }, denied.token)).status, 403);
    assert.equal((await request(origin, "/apps/notify", { text: "test" }, allowed.token)).status, 200);
    assert.ok(events.some((event) => event.type === "app_notify" && event.appId === "app-one"));
    for (const route of ["/apps/ai/complete", "/apps/ai/agent"]) {
      const response = await request(origin, route, {}, allowed.token);
      assert.equal(response.status, 400);
      assert.match((await response.json()).error, /prompt/);
      assert.equal((await request(origin, route, {}, denied.token)).status, 403);
    }
  });
  await t.test("小组件同源接口、数据库隔离与事务", async () => {
    const context = await (await request(widgetOrigin, "/widgets/context")).json();
    assert.equal(context.id, "widget-one");
    assert.deepEqual(context.permissions, ["sql", "ai", "net"]);
    assert.equal((await request(widgetOrigin, "/")).status, 200);
    const sql = async (base: string, statement: string) => (await request(base, "/widgets/sql", { sql: statement })).json();
    await sql(widgetOrigin, "CREATE TABLE records(value TEXT)");
    const batch = await request(widgetOrigin, "/widgets/sql/batch", { statements: [{ sql: "INSERT INTO records VALUES (?)", params: ["first"] }] });
    assert.equal(batch.status, 200);
    assert.equal((await batch.json()).results[0].changes, 1);
    const failed = await request(widgetOrigin, "/widgets/sql/batch", { statements: [{ sql: "INSERT INTO records VALUES ('rollback')" }, { sql: "INSERT INTO absent VALUES (1)" }] });
    assert.equal(failed.status, 400);
    assert.deepEqual((await sql(widgetOrigin, "SELECT value FROM records")).rows, [{ value: "first" }]);
    assert.equal((await request(widgetTwo, "/widgets/sql", { sql: "SELECT * FROM records" })).status, 400);
    assert.equal((await request(widgetDenied, "/widgets/sql", { sql: "SELECT 1" })).status, 400);
  });
  await t.test("小组件界面与能力校验", async () => {
    assert.equal((await request(widgetOrigin, "/widgets/toast", { message: "test" })).status, 200);
    assert.equal((await request(widgetOrigin, "/widgets/open", { url: "https://example.com" })).status, 200);
    assert.equal((await (await request(widgetOrigin, "/widgets/confirm", { message: "test" })).json()).confirmed, true);
    const ai = await request(widgetOrigin, "/widgets/ai", {});
    assert.match((await ai.json()).error, /summary/);
    const net = await request(widgetOrigin, "/widgets/http", { url: "https://example.com" });
    assert.match((await net.json()).error, /域名未声明/);
    assert.equal((await request(widgetOrigin, "/widgets/fs/read", {})).status, 404);
  });
  await t.test("旧前缀没有兼容路由", async () => {
    assert.equal((await request(origin, "/host/me", undefined, allowed.token)).status, 404);
    assert.equal((await request(widgetOrigin, "/_wt/context")).status, 404);
  });
});

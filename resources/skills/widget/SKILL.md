---
name: widget
description: 给 Worktop 造一个侧栏组件(小工具):零构建、目录即安装、有自己的 SQLite。用户要「做个小工具 / 打卡 / 记账 / 看个数据」这类挂在侧栏里用的东西时用这条。
---

# 造组件

组件 = 组件的家里的一个目录。写出目录即安装,自动出现在侧栏「小组件」面板;删目录即卸载。
零构建:浏览器直接吃,不打包、不装依赖。

先用 bash 确认组件的家:`~/.worktop/widgets/`(不是工作目录,不是工作区)。

```
~/.worktop/widgets/<id>/        id:小写字母数字和 -,1..64 位
  widget.json                   manifest(见下)
  index.html                    入口,必需
  main.js / style.css           随便几个 js/css,ES module 互相 import
  data.db                       组件的数据。宿主自动创建,别手建、别读写它
```

## widget.json

```json
{ "name": "习惯打卡", "icon": "✅",
  "description": "一句话说明它干什么(以后靠它判断该不该复用)",
  "permissions": ["sql"],
  "hosts": ["api.open-meteo.com"],
  "position": 10 }
```

| 字段 | 说明 |
|---|---|
| `name` `icon` `description` | 面板里显示;description 也给 AI 看 |
| `permissions` | 要什么写什么,不写就没有:`sql` 自己的库 · `ai` 调 AI · `net` 通过宿主代理访问外网。toast / confirm / open 免申请 |
| `hosts` | `net` 的域名白名单,只放行这些;`["*"]` 任意域名(RSS 阅读器这类) |
| `position` | 列表排序,小的在前;缺省排最后 |

## 宿主 API:同源 HTTP,没有 SDK

组件有自己独立的 origin,`/widgets/*` 由宿主在组件自己的端口应答,直接 `fetch`。这个前缀是宿主保留路径,不要在组件目录里放同名资源:

```js
const sql = (sql, params = []) =>
  fetch("/widgets/sql", { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ sql, params }) }).then((r) => r.json());

await sql("CREATE TABLE IF NOT EXISTS items (id INTEGER PRIMARY KEY AUTOINCREMENT, text TEXT)");
await sql("INSERT INTO items (text) VALUES (?)", ["买牛奶"]);
const { rows } = await sql("SELECT * FROM items ORDER BY id DESC");
```

| 端点 | 权限 | 说明 |
|---|---|---|
| `POST /widgets/sql` `{ sql, params }` → `{ rows, changes }` | sql | 只能碰自己的库 |
| `POST /widgets/sql/batch` `{ statements: [{sql, params}] }` → `{ results }` | sql | 一个事务 |
| `GET /widgets/context` → `{ id, name, permissions }` | — | 组件自身信息与声明的权限 |
| `POST /widgets/ai` `{ summary, system, prompt }` → `{ text, tokens }` | ai | 无状态补全;`summary` 必填,一句话说明目的 |
| `POST /widgets/http` `{ url }` → `{ status, contentType, text }` | net | GET 代理,12s 超时,2MB 上限;只放行 `hosts` |
| `POST /widgets/toast` `{ message }` | — | 右下角轻提示 |
| `POST /widgets/confirm` `{ message }` → `{ confirmed }` | — | 阻塞到用户选择,2 分钟没人理按取消 |
| `POST /widgets/open` `{ url }` | — | 在工作台里开网页标签。**不要用 `target="_blank"`**,那会被丢去系统浏览器 |

组件被 CSP 断网:外网只能走 `/widgets/http`,脚本样式只能来自自己目录。

## 硬性约束(违反了跑不起来)

1. **零构建**:只用浏览器直接能跑的 —— ES module、原生 CSS。不要 JSX / TypeScript / SCSS / 打包器,不要任何外部 CDN。
2. **相对路径**:`<script type="module" src="./main.js">`、`href="./style.css"`。
3. **主题变量**:颜色一律用 `var(--bg)` `var(--bg-raised)` `var(--text)` `var(--text-dim)` `var(--border)` `var(--accent)` `var(--danger)`,宿主注入,明暗主题跟着走。**不要写死背景色和文字色。**
4. **窄**:挂在侧栏面板里,最窄 240px 也要能用。
5. 建表用 `CREATE TABLE IF NOT EXISTS`,启动时跑一次。表结构你自己定,宿主不知道「习惯」「书签」是什么。
6. 样式里加一条 `[hidden]{display:none!important}`,否则 `display:flex` 会盖掉 `hidden`。

## 最小组件

```json
{ "name": "计数器", "icon": "🔢", "description": "点一下加一,记录历史", "permissions": ["sql"] }
```

```html
<!doctype html><meta charset="utf-8">
<link rel="stylesheet" href="./style.css">
<button id="add">+1</button><ol id="log"></ol>
<script type="module" src="./main.js"></script>
```

```js
const sql = (s, p = []) => fetch("/widgets/sql", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sql: s, params: p }) }).then((r) => r.json());
await sql("CREATE TABLE IF NOT EXISTS taps (id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT DEFAULT (datetime('now')))");
const render = async () => { const { rows } = await sql("SELECT * FROM taps ORDER BY id DESC LIMIT 20"); log.innerHTML = rows.map((r) => `<li>${r.at}</li>`).join(""); };
add.onclick = async () => { await sql("INSERT INTO taps DEFAULT VALUES"); render(); };
render();
```

## 什么时候不造组件

用户要的是独立网站、仓库、命令行工具、原生 app,或者只是一个看一眼的单页 HTML —— 那就按普通文件写在工作目录里。
需要真后端、要装依赖、要整页宽度的 —— 那是**应用**,不是组件。

## 写完

告诉用户组件名,它在侧栏「小组件」面板里,点开就能用。

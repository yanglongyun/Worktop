# Worktop 1.7.0 API 清单

状态：**已实施**。更新日期：2026-09-07。

本文以当前仓库实现为依据，完整列出 Worktop 主界面 API、应用宿主 API、组件宿主 API、WebSocket 与健康检查，按职责分层说明当前接口。附录列出预装应用自己的接口。

本文是当前路由与能力清单，不是完整的字段校验规范。表内列出主要参数和返回内容。

## 1. 总体结构

```text
主服务
├── /health                         健康检查，保持不变
├── /api/ws                         WebSocket，保持不变
├── /api                            主界面使用的管理接口
│   ├── /chats                      对话、消息、运行、对话确认
│   ├── /files                      文件树、常用目录、上传、附件、预览
│   ├── /browser                    收藏、历史、网站密码、网站图标
│   ├── /apps                       应用管理、应用任务
│   ├── /widgets                    组件管理
│   ├── /skills                     技能管理
│   ├── /settings                   全局配置、全局规则
│   ├── /system                     系统目录选择器、Finder 定位
│   └── /git                        Git 版本管理
└── /apps                           应用调用宿主的能力接口
    ├── /me
    ├── /ai/complete
    ├── /ai/agent
    └── /notify

每个组件的独立端口
├── /widgets                        组件调用宿主的能力接口
│   ├── /context
│   ├── /sql
│   ├── /sql/batch
│   ├── /ai
│   ├── /http
│   ├── /toast
│   ├── /confirm
│   └── /open
└── /…                              组件静态页面与资源

每个应用的独立地址
└── /…                              应用自行定义的页面和业务接口
```

### 1.1 模块边界与命名理由

| 模块 | 负责什么 | 边界 |
|---|---|---|
| `chats` | 用户与 AI 的对话及其执行过程 | 不持有工作目录，不管理文件树；应用任务列表归 apps |
| `files` | 浏览和管理本地文件、常用根目录、附件存取 | 常用目录只是文件入口，不是 Agent 工作环境 |
| `browser` | 内置浏览器的收藏、历史、网站密码与图标 | 不泛指所有联网能力；组件联网仍走 `/widgets/http` |
| `apps` | 应用注册信息、运行生命周期、应用任务 | `/api/apps` 管理应用；`/apps` 是应用调用宿主，不能混用 |
| `widgets` | 组件注册信息、运行站点、移除、确认回执 | `/api/widgets` 管理组件；组件能力在自身端口 `/widgets` 下 |
| `skills` | 技能列表、启停、文档 | 即使入口在设置页，仍是独立资源 |
| `settings` | 模型、提示词、压缩等配置及全局规则 | 规则影响整个产品，不属于某个对话 |
| `system` | 原生系统交互 | 不作为上传、设置等杂项的收纳目录；目前不新增系统状态 API |
| `git` | 状态、差异、提交、分支和远端操作 | 独立的版本管理能力，不塞进文件树层级 |

不采用 `workspaces`：当前没有对话绑定目录或 Agent 工作区，这个名字会制造错误暗示。常用根目录使用 `files/roots`。

保留 `chats`：它直接对应产品中的对话；不改为容易和登录、终端混淆的 `sessions`，也无需换成更长的 `conversations`。

### 1.2 路径规则

- 按职责分组，通常保持“模块 / 资源 / 动作”三级以内。
- 固定路径段统一使用小写单词，不用连字符 `-`、下划线或驼峰拼接词。需要层级时使用 `/`，能够用准确单词表达时直接简化命名；不机械拆分每个英文词。此规则不限制动态 ID、文件名、实际文件路径和请求字段。
- 单项资源主要使用 query ID；不混用多套资源定位方式。
- 下表 `Q` 表示 query 参数，`B` 表示 JSON 请求体；`?` 表示可选。
- 路径中的 `:id`、`<绝对路径>` 是占位符，不是字面字符串。
- 文件节点 ID 可能包含路径字符，必须 URL 编码。附件 ID 与文件节点 ID 是两种标识，分别使用明确的子路径。
- 原始文件、附件、图标、CSV 和 SSE 返回流或文件内容，不强行包装成 JSON。
- 当前 JSON 响应存在有无 `ok` 的差别，以各模块返回为准。
- 文件节点读取限定 GET。健康检查保持现有行为。
- 产品只提供本文列出的当前接口，不提供别名或兼容入口。

## 2. 对话 `/api/chats`

| 方法 | 路径 | 主要参数 | 用途 / 返回内容 |
|---|---|---|---|
| GET | `/api/chats` | 无 | 对话列表 `chats` |
| POST | `/api/chats` | B: `title, system?` | 创建对话，返回 `item` |
| PATCH | `/api/chats` | Q: `id`；B: `title?, system?, pinned?` | 更新对话，返回 `item` |
| DELETE | `/api/chats` | Q: `id` | 删除对话，返回 `deleted` |
| GET | `/api/chats/get` | Q: `id` | 单个对话 `item` |
| POST | `/api/chats/read` | Q: `id` | 标记已读，返回 `item` |
| GET | `/api/chats/messages` | Q: `chatId` | 已存消息、工具调用及结果等记录 `rows` |
| GET | `/api/chats/runs` | 无 | 正在运行的用户对话 ID 列表 `ids` |
| GET | `/api/chats/approvals` | Q: `chatId` | 该对话尚待答复的确认项 `approvals` |
| POST | `/api/chats/approvals` | B: `id, answer` | 提交确认答复，返回处理结果 `ok` |

**创建时机**：点击“新建对话”只打开起始页面；用户首次提交消息时，前端才创建对话，然后通过 `/api/ws` 的 `send` 发送消息。此处不新增 HTTP 发送或停止接口，也不将“创建 + 发送”描述成已经具备的原子事务。

**消息共享事实**：当前应用任务也把过程存入 messages，并用任务 ID 作为 `chatId` 读取。所以 `/api/chats/messages` 暂时承载应用任务消息读取；本方案不再增加一条重复的 `/api/apps/tasks/messages`。对话列表与应用任务列表仍独立。

## 3. 文件 `/api/files`

### 3.1 常用根目录

| 方法 | 路径 | 主要参数 | 用途 / 返回内容 |
|---|---|---|---|
| GET | `/api/files/roots` | 无 | 常用根目录列表，字段 `roots` |
| POST | `/api/files/roots` | B: `path, title?` | 添加常用目录并启动文件监听，返回 `item` |
| DELETE | `/api/files/roots` | Q: `id` | 移除常用入口及其监听，字段 `root` |

移除常用入口不等于删除磁盘目录。这里没有创建 Agent 工作区的动作。

常用目录保存在 `file_roots` 表中；文件树节点的 `isRoot` 表示它是常用根目录。添加和移除只影响文件浏览入口与监听。

### 3.2 文件树与内容编辑

| 方法 | 路径 | 主要参数 | 用途 / 返回内容 |
|---|---|---|---|
| GET | `/api/files/tree` | Q: `parentId?` | 列出子节点 `items`；空值表示根层 |
| POST | `/api/files/tree` | B: `kind, title, parentId?, content?` | 创建文件或文件夹，返回 `item` |
| PATCH | `/api/files/tree` | Q: `id`；B: `title?, content?, parentId?, overwrite?` | 重命名、编辑文本或移动节点，返回 `item` |
| DELETE | `/api/files/tree` | Q: `id` | 删除文件或文件夹节点 |
| GET | `/api/files/tree/get` | Q: `id` | 单个节点及可读取的文本内容 `item` |
| GET | `/api/files/tree/all` | 无 | 扁平节点列表 `items`，供快速打开 |
| POST | `/api/files/tree/copy` | B: `id, parentId?` | 复制节点，返回 `item` |
| POST | `/api/files/tree/import` | B: `parentId?, relPath, dataBase64` | 把文件导入文件树，返回 `item` |

`tree/import` 把内容写入用户文件目录；下节 `upload` 把内容保存为附件，两者用途不同。

### 3.3 文件预览与附件

| 方法 | 路径 | 主要参数 | 用途 / 返回内容 |
|---|---|---|---|
| GET | `/api/files/raw` | Q: `id` | 按节点 ID 返回图片、PDF 等原始文件 |
| GET | `/api/files/local/<绝对路径>` | 路径后缀 | 本地文件及 HTML 相对资源预览 |
| POST | `/api/files/upload` | B: `name, mimeType, dataBase64` | 上传附件，返回 `attachment` 元数据 |
| GET | `/api/files/attachments/:id` | 路径: 附件 `id` | 读取已上传附件的原始内容 |

预览示例：`/api/files/local/Users/me/project/index.html`。相对的 `style.css` 自然解析到同目录；不能改成单个 query 文件下载接口，否则相对资源会失去目录上下文。

路径改名不扩大文件访问范围，仍由现有文件解析与访问约束处理。附件元数据中的 `url` 必须由服务端生成新路径；不能只修改前端 fetch。

## 4. 浏览器 `/api/browser`

### 4.1 收藏

| 方法 | 路径 | 主要参数 | 用途 / 返回内容 |
|---|---|---|---|
| GET | `/api/browser/bookmarks` | 无 | 收藏列表，字段 `bookmarks` |
| POST | `/api/browser/bookmarks` | B: `url, title?, parentId?` | 添加收藏，返回 `item` |
| PATCH | `/api/browser/bookmarks` | Q: `id`；B: `title?, url?` | 修改收藏，返回 `item` |
| DELETE | `/api/browser/bookmarks` | Q: `id` | 删除收藏或收藏文件夹，返回 `deleted` |
| POST | `/api/browser/bookmarks/folder` | B: `title?, parentId?` | 创建收藏文件夹，返回 `item` |
| POST | `/api/browser/bookmarks/order` | B: `parentId, ids` | 提交整层顺序和归属，字段 `bookmarks` |
| GET | `/api/browser/favicon` | Q: `url` | 获取网站图标，返回图片 |

列表和排序响应使用 `bookmarks` 字段，收藏保存在 `browser_bookmarks` 表中。这里的收藏与组件运行站点 `/api/widgets/sites` 不是同一种资源。

### 4.2 历史

| 方法 | 路径 | 主要参数 | 用途 / 返回内容 |
|---|---|---|---|
| GET | `/api/browser/history` | Q: `q?, limit?` | 搜索或读取历史 `history` |
| DELETE | `/api/browser/history` | Q: `url` 或 `all=1` | 删除指定网址历史或清空，返回 `forgot` |
| POST | `/api/browser/history/visit` | B: `url, title?` | 记录访问，返回 `noted` |

### 4.3 网站密码

| 方法 | 路径 | 主要参数 | 用途 / 返回内容 |
|---|---|---|---|
| GET | `/api/browser/passwords` | 无 | 密码条目列表 `passwords`，不返回明文密码 |
| POST | `/api/browser/passwords` | B: `url?, username?, password?, note?` | 创建条目，返回 `item` |
| PATCH | `/api/browser/passwords` | Q: `id`；B: 条目修改字段 | 更新条目，返回 `item` |
| DELETE | `/api/browser/passwords` | Q: `id` 或 `all=1` | 删除单条 `deleted` 或全部清空 `cleared` |
| GET | `/api/browser/passwords/reveal` | Q: `id` | 读取单条明文 `password` |
| POST | `/api/browser/passwords/import` | B: `items` | 批量导入，返回新增数量 `added` |
| GET | `/api/browser/passwords/export` | 无 | 导出密码 CSV |

明文读取和导出保持 `Cache-Control: no-store`。这组是浏览器凭据，不是模型 API Key 的设置入口。

## 5. 应用管理 `/api/apps`

| 方法 | 路径 | 主要参数 | 用途 / 返回内容 |
|---|---|---|---|
| GET | `/api/apps` | 无 | 应用信息与运行状态 `apps` |
| GET | `/api/apps/address` | Q: `id` | 获取 `origin`，未运行时启动，运行中续期 |
| POST | `/api/apps/stop` | B: `id` | 停止应用 |
| POST | `/api/apps/restart` | B: `id` | 重启应用 |
| GET | `/api/apps/doc` | Q: `id` | 读取 APP.md，返回 `doc` |
| GET | `/api/apps/icon` | Q: `id` | 返回应用图标文件 |
| GET | `/api/apps/tasks` | Q: `limit?` | 应用发起的任务列表 `tasks` |

`address` 是带启动副作用的 GET，不能将其当成纯查询随意预取。地址每次现取，不缓存端口。stop/restart 只从 JSON body 读取 ID。

当前没有独立的“创建应用” HTTP 接口；不能因为 UI 有创建入口就虚构 `/api/apps/create`。

## 6. 组件管理 `/api/widgets`

| 方法 | 路径 | 主要参数 | 用途 / 返回内容 |
|---|---|---|---|
| GET | `/api/widgets` | 无 | 组件列表 `widgets` |
| GET | `/api/widgets/url` | Q: `id` | 获取 `url`，必要时启动组件站点 |
| GET | `/api/widgets/sites` | 无 | 运行站点、端口与空闲状态 `sites` |
| POST | `/api/widgets/remove` | B: `id` | 移除组件、关闭站点与数据库，返回 `trashed` |
| POST | `/api/widgets/confirm/result` | B: `requestId, ok` | 主界面提交用户确认答复 |

`url` 可能启动站点。组件移除使用现有回收站机制。当前没有独立创建组件 HTTP 接口。

## 7. 技能 `/api/skills`

| 方法 | 路径 | 主要参数 | 用途 / 返回内容 |
|---|---|---|---|
| GET | `/api/skills` | 无 | 技能列表 `skills` |
| POST | `/api/skills/toggle` | B: `id, enabled` | 启用或停用技能 |
| GET | `/api/skills/doc` | Q: `id` | SKILL.md 原文 `content` 及 `id` |

技能查看仍打开文件标签页；API 分组不改变 UI。现有接口不提供创建、删除技能，不补不存在的路由。

## 8. 设置 `/api/settings`

### 8.1 配置

| 方法 | 路径 | 主要参数 | 用途 / 返回内容 |
|---|---|---|---|
| GET | `/api/settings` | 无 | 当前 `settings` 与默认提示词 `promptDefaults` |
| POST | `/api/settings` | B: 配置修改字段 | 保存配置，返回生效后的 `settings` |

配置包括 `apiUrl`、`apiKey`、`model`、`system`、`compactPrompt`、`compressThreshold`、`toolResultMaxChars`、`telemetry`、`rulesEnabled`。默认提示词继续由服务端统一提供。无需为每个设置 Tab 创建空壳 API。

### 8.2 全局规则

| 方法 | 路径 | 主要参数 | 用途 / 返回内容 |
|---|---|---|---|
| GET | `/api/settings/rules` | 无 | 全局规则 `rules` |
| POST | `/api/settings/rules` | B: `text` | 创建规则，返回 `rule` |
| PATCH | `/api/settings/rules` | Q: `id`；B: `text?, enabled?` | 修改规则，返回 `rule` |
| DELETE | `/api/settings/rules` | Q: `id` | 删除规则，返回 `deleted` |
| POST | `/api/settings/rules/order` | B: `ids` | 调整全局顺序，返回 `rules` |

规则定义归 settings；某次运行中产生的待确认事项归 chats。规则 PATCH 只从 query 读取 ID。

## 9. 系统 `/api/system`

| 方法 | 路径 | 主要参数 | 用途 / 返回内容 |
|---|---|---|---|
| POST | `/api/system/directory/pick` | 无 | 打开原生目录选择器，返回 `path`；取消返回 `null` |
| POST | `/api/system/reveal` | Q: `id` | 在 Finder / 系统文件管理器定位节点，返回 `path` |

选择目录不会自动添加常用入口。reveal 目前仍用现有节点 ID 解析机制，移动前缀不会让它自动变成任意路径访问接口。

终端通过 WebSocket 控制，不额外制造 `/api/system/terminal/*`。系统版本、更新、窗口控制等现有 Electron IPC 不为凑清单改成 HTTP。

## 10. Git `/api/git`

`diff` 返回供差异视图使用的两侧完整内容，不是补丁文本。

| 方法 | 路径 | 主要参数 | 用途 / 返回内容 |
|---|---|---|---|
| GET | `/api/git/status` | 无 | 当前收集的仓库状态 `repositories` |
| GET | `/api/git/repository` | Q: `path` | 指定路径所属仓库状态 `repository` |
| GET | `/api/git/diff` | Q: `root, path, staged?, commit?` | 差异两侧 `before, after, binary` |
| GET | `/api/git/log` | Q: `root, limit?` | 提交记录 `commits` |
| GET | `/api/git/show` | Q: `root, hash` | 指定提交的文件清单 `files` |
| GET | `/api/git/branches` | Q: `root` | 当前分支与分支列表 |
| POST | `/api/git/stage` | B: `root, path? 或 all?` | 暂存，返回仓库状态 |
| POST | `/api/git/unstage` | B: `root, path? 或 all?` | 取消暂存，返回仓库状态 |
| POST | `/api/git/discard` | B: `root, path` | 丢弃文件修改，返回仓库状态 |
| POST | `/api/git/commit` | B: `root, message` | 提交，返回输出与仓库状态 |
| POST | `/api/git/remote` | B: `root, action` | action 为 fetch / pull / push，返回执行结果 |
| POST | `/api/git/checkout` | B: `root, branch` | 切换分支，返回输出、仓库及分支状态 |

`root` 是这次 Git 操作的仓库路径，不是对话的持久工作目录。仓库状态用 `fileRootId`、`fileRootTitle`、`fileRootPath` 描述常用根目录；`root` 表示 Git 仓库根路径。

## 11. 应用调用宿主 `/apps`

**全部保持不变。** 位于主服务端口；应用通过 `HOST_URL` 访问，以 `Authorization: Bearer <APP_TOKEN>` 识别应用身份，再检查 manifest 权限。

| 方法 | 路径 | 权限 | 主要输入 | 返回 / 用途 |
|---|---|---|---|---|
| GET | `/apps/me` | 有效应用凭证 | 无 | `appId, name, version, permissions` |
| POST | `/apps/ai/complete` | `ai.complete` | `prompt, instructions?, title?, schema?, schemaName?` | 单次补全，返回 `text, usage`，记录应用任务 |
| POST | `/apps/ai/agent` | `ai.agent` | `prompt, title?, cwd?` | 完整 Agent 任务，SSE 返回执行过程 |
| POST | `/apps/notify` | `notify` | `text, kind?` | toast / badge 通知，返回 `ok` |

`cwd` 是某次应用任务的执行参数，当前省略时使用应用自身目录；它不建立用户对话与文件夹的绑定。当前应用 Agent 任务不经过用户对话规则，这个行为也不会因路径分组而改变。

应用自身的文件、网络、进程操作由应用运行环境承担；本清单不新增 `/apps/fs`、`/apps/http` 等宿主转发接口。

## 12. 组件调用宿主 `/widgets`

**全部保持不变。** 请求发往组件自己的独立回环端口；宿主依据端口绑定的组件确定身份。组件不能通过传入别的组件 ID 来选数据库。

| 方法 | 路径 | 权限 | 主要输入 | 返回 / 用途 |
|---|---|---|---|---|
| GET | `/widgets/context` | 无额外权限 | 无 | `ok, id, name, permissions` |
| POST | `/widgets/sql` | `sql` | `sql, params?` | 自身数据库查询或写入，返回 `rows, changes, lastInsertRowid` |
| POST | `/widgets/sql/batch` | `sql` | `statements: [{sql, params?}]` | 批量事务，返回 `results` |
| POST | `/widgets/ai` | `ai` | `summary, system?, prompt` | 模型补全结果 |
| POST | `/widgets/http` | `net` + hosts 放行 | `url` | 代理外部 GET 请求 |
| POST | `/widgets/toast` | 无额外权限 | `message` | 轻提示 |
| POST | `/widgets/confirm` | 无额外权限 | `message` | 等待用户选择，返回 `confirmed` |
| POST | `/widgets/open` | 无额外权限 | `url` | 在 Worktop 打开 http(s) 网页标签 |

确认链路：组件 `/widgets/confirm` → 主界面收到 `widget_confirm` → `/api/widgets/confirm/result` 回执 → 组件收到结果。不能把它与 `/api/chats/approvals` 混为同一套确认。

组件不存在通用 `fs` 权限及文件读写 API，不在文档中保留虚构能力。

## 13. WebSocket `/api/ws`

路径和消息名保持不变。下面列的是消息 `type`，不是 HTTP 子路由。

### 13.1 主界面发给服务端

| type | 用途 | 主要数据 |
|---|---|---|
| `send` | 提交消息并推动对话运行 | `chatId, prompt, attachments?` |
| `stop` | 停止对话运行 | `chatId` |
| `terminal_start` | 启动终端 | `terminalId, cwd?, cols?, rows?, title?` |
| `terminal_input` | 写入终端 | `terminalId, data` |
| `terminal_resize` | 调整终端尺寸 | `terminalId, cols, rows` |
| `terminal_stop` | 关闭终端 | `terminalId` |
| `web_host_hello` | 注册浏览器执行宿主 | 宿主连接 |
| `web_tab_register` | 注册浏览器标签 | 标签信息 |
| `web_tab_update` | 更新标签信息 | 标签信息 |
| `web_tab_unregister` | 注销标签 | 标签标识 |
| `browser_response` | 返回浏览器工具执行结果 | 请求标识及结果 |

终端未指定 cwd 时使用用户主目录。终端、浏览器和对话共享双向通道，不要求共享生命周期或目录。

### 13.2 服务端事件分组

| 分组 | 事件 |
|---|---|
| 连接与协议错误 | `connected`、`error` |
| 对话输入与启动 | `conversation.input`、`conversation.run.start` |
| 文本与思考 | `conversation.message.delta`、`conversation.reasoning.delta` |
| 工具调用 | `conversation.tool.call.start`、`conversation.tool.calls`、`conversation.tool.output` |
| 压缩与重试 | `conversation.compact.start`、`conversation.compact.done`、`conversation.run.retry` |
| 本轮运行终局 | `conversation.run.done`、`conversation.run.aborted`、`conversation.run.error` |
| 对话确认 | `approval_ask`、`approval_done` |
| 终端 | `terminal_started`、`terminal_output`、`terminal_exit`、`terminal_error` |
| 浏览器执行 | `browser_request`、`web_tab_open` |
| 应用任务与通知 | `tasks_changed`、`app_notify` |
| 组件交互 | `widget_toast`、`widget_confirm`、`widget_open_url` |

`conversation.input` 通知已落库的上下文输入记录，包括用户消息、压缩摘要和系统留痕；记录仍通过该事件发送。压缩与运行事件负责状态变化，不重复传递记录。思考与正文增量携带 `content`，所有对话事件带 `chatId`。

此外，文件、对话、应用、技能、组件等目录或资源变化仍使用现有 bus 变更事件；上表是按能力分组的主要事件说明，不是全部事件字段的协议定义。此次 HTTP 前缀调整不重命名事件。

## 14. 健康检查、页面与其他通信

| 入口 | 归属 | 行为 |
|---|---|---|
| `/health` | 主 HTTP 服务 | 返回 `{ok:true}`；当前未限制方法，按要求保持不变 |
| `/`、`/index.html`、`/assets/*` | 主 HTTP 服务 | UI 静态资源与 SPA 页面 |
| 组件端口 `/` 及非 `/widgets/*` 资源 | 组件站点 | 组件 HTML、JS、CSS 等 |
| 应用独立地址 | 应用进程或静态服务 | 应用自己的页面和业务路由 |
| Electron IPC | 桌面主进程与渲染进程 | 原生窗口、系统与浏览器等能力，不属于 HTTP API |

主 API 未命中时返回 API 错误；页面回退逻辑不能把错误的 API 路径伪装成成功页面。应用与组件管理取回的端口可能变化，不能将开发端口写死为接口契约。

## 15. 代码归属

HTTP 路由代码按以下模块组织：

```text
server/http/api/
├── index.ts
├── helpers.ts
├── chats.ts        对话、消息、运行、确认
├── files.ts        常用根目录、文件树、预览、附件
├── browser.ts      收藏、历史、密码、图标
├── apps.ts         应用生命周期与任务列表
├── widgets.ts      组件管理
├── skills.ts       技能管理
├── settings.ts     配置与全局规则
├── system.ts       原生目录选择、Finder 定位
└── git.ts          版本管理
```

HTTP 模块只解析输入、调用领域服务和组织响应，不把浏览器密码加密、文件操作、Agent 执行等业务全部搬进路由文件。

领域实现：

- `server/files/`：文件树、常用根目录、文件监听与附件存储。
- `server/browser/`：浏览器执行宿主、收藏、历史、密码和图标。
- `server/chats/`：对话、消息、模型输入、提示词组装、运行与确认。
- `server/settings/`：设置、默认值、规则及新库默认规则写入。
- `server/database/`：数据库连接与当前建表定义。
- `server/system/`：系统路径与原生目录选择。
- `server/git/`：Git 仓库操作。
- `server/apps/`、`server/widgets/`、`server/skills/`：各自的注册与执行能力。
- `ui/src/api/`：按同名业务模块拆分主界面请求与类型；确认答复归 `chats.ts`，规则归 `settings.ts`。

前端 API 调用、附件元数据 URL、文件预览与图标 URL 均使用本清单中的路径。原生应用和组件的宿主能力接口、WS 消息协议与健康检查保持稳定。

## 附录 A. 预装应用自身接口（现状，保持不变）


以下路径在各应用自己的端口上，不能直接当成主服务的路径调用。仅列仓库预装实现；用户自行安装的应用可有任意其他路由。

### 笔记 Notes

| 方法 | 路由 | 用途 |
|---|---|---|
| GET | `/health` | 健康检查 |
| GET | `/api/tree` | 笔记树 |
| GET | `/api/search` | 搜索 |
| GET / PATCH / DELETE | `/api/pages/:id` | 读 / 改 / 删笔记 |
| GET / PUT | `/api/pages/:id/body` | 读取 / 保存 Markdown 正文 |
| POST | `/api/pages` | 创建笔记 |
| POST | `/api/pages/:id/move` | 移动笔记 |
| POST | `/api/ping` | 连通检查 |
| GET（SSE） | `/api/events` | 变更通知 |

### 思维导图 Mindmap

| 方法 | 路由 | 用途 |
|---|---|---|
| 任意 | `/health、/api/health` | 健康检查；当前未限制 HTTP 方法 |
| POST | `/api/sql` | 导图数据库操作 |
| 任意 | `/sdk/chatnext.js` | 提供脚本；当前未限制 HTTP 方法 |

其余路径由应用静态文件服务处理。

### 创意 Ramify

| 方法 | 路由 | 用途 |
|---|---|---|
| GET | `/api/health` | app |
| POST | `/api/projects/:projectId/generate` | generation.routes |
| POST | `/api/nodes/:nodeId/branch` | generation.routes |
| POST | `/api/projects/:projectId/nodes` | node.routes |
| POST | `/api/projects/:projectId/nodes/batch` | node.routes |
| PUT | `/api/nodes/:nodeId` | node.routes |
| PUT | `/api/nodes/:nodeId/artifact` | node.routes |
| PUT | `/api/nodes/:nodeId/artifact/error` | node.routes |
| DELETE | `/api/nodes/:nodeId/artifact` | node.routes |
| DELETE | `/api/nodes/:nodeId` | node.routes |
| GET | `/api/nodes/:nodeId/html` | node.routes |
| GET | `/api/nodes/:nodeId/content` | node.routes |
| GET | `/api/nodes/:nodeId/artifact/source` | node.routes |
| GET | `/api/nodes/:nodeId/artifact` | node.routes |
| GET | `/api/projects` | project.routes |
| GET | `/api/projects/version` | project.routes |
| POST | `/api/projects` | project.routes |
| PUT | `/api/projects/:projectId` | project.routes |
| DELETE | `/api/projects/:projectId` | project.routes |
| GET | `/api/projects/:projectId/tree` | project.routes |
| GET | `/api/projects/:projectId/version` | project.routes |
| GET | `/api/settings` | settings.routes |
| PUT | `/api/settings/theme` | settings.routes |
| PUT | `/api/settings/locale` | settings.routes |

Ramify 的路由器还将 HEAD 按 GET 匹配。页面及静态资源由其自身静态服务提供。


## 附录 B. 核对依据

- 主 HTTP：`server/http/api/*.ts`。
- 主界面调用与类型：`ui/src/api/`。
- 应用宿主能力：`server/apps/bridge.ts`。
- 组件宿主能力：`server/widgets/site.ts`。
- WebSocket：`server/http/ws.ts`、`server/shared/events.ts`、`server/terminals/terminals.ts`、`server/browser/host.ts`。
- 现有完整路由记录：`docs/http-routes.md`。

接口实现与调用方已同步更新。

## 数据类型与存储归属

对话响应使用 `Chat`，不含 `parent_id`、`content`。文件树使用 `FileNode`，`kind` 为 `folder` 或 `file`，不含 `system`、`last_read_at`。两者在标签页层组合，不共用混合节点类型。

主数据库共有十张业务表：`chats`、`messages`、`compactions`、`tasks`、`settings`、`settings_rules`、`file_roots`、`browser_bookmarks`、`browser_history`、`browser_passwords`。前四张表的名称、字段和关系保持原样。数据库表用下划线表达领域归属，HTTP 继续用 `/` 表达资源层级。

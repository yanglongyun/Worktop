# Worktop ▲

> 一个本地工作台:左边是**对话**、**文件**、**网站**,中间是标签页,侧栏挂着你自己的**组件**。

## 它是什么

一套 VSCode 式的本地 GUI,把日常工作需要的几样东西合到一处:

- **对话** —— 与个人 AI 助手交流,按任务需要跑命令、读写本地文件、操作网页;
- **文件** —— 手动添加的常用文件夹,可浏览、编辑、预览;与对话独立;
- **网站** —— 内置真浏览器(带你的登录态),收藏的站点一点就开;
- **组件** —— 零构建的小工具,写个目录就装上了,大多由 AI 替你造。

## 对话与文件独立

对话、消息和压缩摘要保存在 SQLite,创建对话不创建文件夹。
命令默认从用户主目录 `~` 开始,每次 `bash` 可用 `cwd` 指定执行位置。
文件工具支持绝对路径与 `~/`,无需先将文件夹加入文件面板。

用户指定保存位置时使用该位置;未指定的新产物可放在 `~/worktop/outputs/<对话ID>/`,
需要写入文件时才创建目录。应用发起的任务可通过 `cwd` 指定本轮目录,默认在应用目录执行。
项目约定与技能在实际操作项目时按需读取,不会因文件面板选择而自动注入。

## 它如何存储:文件系统即真相

用户的资产在文件系统里,SQLite 只存过程:

```
<常用文件夹>/                     ← 你手动添加的文件夹,可以多个,会记住;默认一个都没有
  研究/
    notes.md                   ← 真实文件
    src/ app.js                ← AI 用 bash 建的嵌套结构
~/.worktop/                  ← 产品自己的家:应用、组件、它们的数据
```

| 表 | 内容 |
|---|---|
| `chats` | 对话(标题 / 人格 / 已读位置) |
| `messages` | 每个对话的消息流,一行一个 Responses item |
| `compactions` | 上下文压缩的摘要与水位 |
| `settings` | 模型 / key / 默认 system prompt |
| `workspaces` | 文件浏览入口(手动添加的文件夹) |
| `sites` | 「网站」面板的收藏 |

**运行状态不落库** —— 跑到一半的轮次重启后本就恢复不了,而发生过什么已经逐条记在 `messages` 里。

## AI 手里的工具(5 个)

一个不多。能用通用能力表达的,就不单开一个工具:

| 工具 | 用途 |
|---|---|
| `bash` | 在本机执行命令,默认从 `~` 开始,`cwd` 可指定本次目录。`background: true` 转后台(dev server / watch),立即返回进程 id、pid、日志路径;忘了写也会被自动识别 |
| `read` · `edit` · `write` | 带行号读(可分页,也能读图)/ 精确替换 / 新建或整体重写 |
| `browser` | 操作网页标签(内置真浏览器,真实登录态):开 / 跳转 / 读正文 / 执行 JS / 点击 / 填字 / 截图 |

> ⚠️ `bash` 在**你本机**执行任意命令、**无沙箱**。只在你信任的机器、对你信任的模型使用。

## 组件

组件 = 组件的家里的一个目录,**零构建**(ESM + 原生 CSS,浏览器直接吃),写出目录即安装:

```
~/.worktop/widgets/<id>/
  widget.json   manifest(名字 / 图标 / 权限)
  index.html    入口
  main.js  style.css
  data.db       组件自己的 SQLite,和代码做邻居
```

每个组件跑在**自己的 origin** 上(一个 loopback 端口),宿主 API 是同源 HTTP
(`fetch("/_wt/sql")`),不需要任何 SDK;默认被 CSP 断网,权限在 manifest 里明文声明。

完整契约是一条出厂技能:`~/.worktop/skills/widget/SKILL.md`(源在 `resources/skills/widget/`)。AI 造组件时自己读它,你也可以改它。

## 用起来什么感觉

- **流式输出**,思考与正文逐字实时呈现;完成的一轮收纳成「已工作 X 秒」折叠条
- 模型协议是 **Responses**,不随供应商变 —— 接任何 Responses 兼容接口 / 网关
- **多标签 + 左右分屏**;代码按扩展名高亮(CodeMirror);Markdown / HTML / 图片 / PDF 直接预览
- **⌘P 快速打开 · ⌘⇧P 命令面板**
- 对话运行时亮**蓝点**、有未读亮**绿点**
- 内置**终端**(默认从主目录启动,也可在指定文件夹里运行命令)与一个 **Git 面板**

## 跑起来

```bash
git clone https://github.com/yanglongyun/Worktop
cd Worktop
npm install

# 开发(两个进程)
npm run dev          # 后端,tsx watch,端口 9506
npm run ui           # 前端,vite dev,端口 5174(代理到 9506)

# 生产(构建 GUI,单端口运行)
npm run build
npm start            # http://localhost:9506

# 桌面客户端(Electron 壳)
npm run app

# 打成 macOS 应用
npm run dist:mac
```

开发模式打开 **http://localhost:5174/**:

1. 左下角 ⚙ Settings → 填 API URL / API Key / Model(任何 Responses 兼容接口)
2. 「会话」面板 `＋` → 新建一个对话
3. 发条消息试试 —— 让它「做个喝水打卡的组件」,看它写出目录,然后在侧栏「小组件」里点开

## 技术栈

Node 22+ · TypeScript · `node:sqlite`(内置,零外部数据库依赖)· React 19 · Tailwind 4 ·
Vite · CodeMirror 6 · @dnd-kit · ws · Electron

## 想读代码——架构

按领域分目录,一个目录一句话说清;领域之间不互相 import。

```
server/
├── index.ts      🚀 启动装配;db / home / settings / bus / telemetry 谁都要用,留在根上
├── ai/           🧠 Responses API 客户端(纯 JS 零依赖):请求 / 读流 / 重试 / 单次补全
├── agent/        🔁 循环(模型 → 工具 → 模型)、循环内压缩、tools.ts 定义表、functions/ 六个工具的实现
├── http/         🌐 HTTP 的皮:api/(每个资源一个文件)/ ws(WebSocket)/ static / origin
├── chat/         🎬 一轮怎么跑:turn(编排、逐条落库、压缩记账)/ system(提示词)/ approvals / rules / files
├── workspace/    🌳 文件树:tree / watcher / search / git / directoryPicker
├── apps/         📦 应用宿主:registry / supervisor / bridge(/host/*)/ tasks
├── widgets/ sites/ skills/ browser/ terminals/   各管一样东西
└── shared/       📜 事件名契约,服务端与界面共用一份
desktop/          🖥 Electron 壳:esbuild 单文件 server 由壳拉起,窗口指向 127.0.0.1
ui/src/components/   React 前端:sidebar(三原生 + 组件)/ workspace(标签页)/ chat / files / widgets
```

`server/agent/` 不知道对话是什么,只接收组装好的 items、工具表和 run(call) 跑循环;压缩在循环里每次请求前判断。消息**逐条落库**:
每个 item(思考 / 正文 / 工具调用 / 结果)完成即入库,中途停止只丢正在流式的半句。

## 几句实话

- `bash` 全功能、**无沙箱**,只在你信任的机器、对你信任的模型使用。
- 提示词与注释**均为中文**,不习惯的话需要适应。
- 它是实验性的,不面向生产。

## License

MIT

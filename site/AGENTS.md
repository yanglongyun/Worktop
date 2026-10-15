# AGENTS.md

`worktop` —— Worktop 的子站与后端,一个 Worker 接两个 hostname。

| hostname | 做什么 |
|---|---|
| `worktop.iimos.ai` | 子站(React 静态资源) |
| `api.worktop.iimos.ai` | 只做**因人而异**的事:`/notices`(按版本过滤)、`/t`(遥测) |

## 不在这里的东西

- **安装包与更新清单**在 worktop 自己的 R2 桶 `worktop` 里,经 `worktop.iimos.ai/download/<平台>/<文件>` 给出
  (比如 `/download/mac-arm64/latest-mac.yml`)。桌面端 electron-updater 的更新地址填 `https://worktop.iimos.ai/download/mac-arm64`。
- **校验**不在服务端:`electron-updater` 用清单里的 sha512 在客户端自己核。
- **更新检查**不需要接口:走 electron-updater 原生的静态清单流程。
  真要做灰度或强制更新时再加 `/update`,别提前造。

判断标准只有一条:**响应对所有人一样就交给 R2,需要先知道「你是谁」才交给 Worker。**

## 开发

```bash
npm install
npm run build
npm run deploy
wrangler d1 execute worktop --remote --file=schema.sql   # 首次
```

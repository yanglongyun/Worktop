# AGENTS.md

`gateway` —— gateway.iimos.ai,带额度的 Responses API 中转站。给试水用户发 key,不用自己配模型。

## 边界

- 只做一件事:`POST /v1/responses` 原样转发到上游(`UPSTREAM_URL`),换掉 Authorization,按 usage 记账。
  请求体一个字段不改:`text.format`、`tools`、`stream`、`reasoning` 全部透传。模型换了、字段多了,这里不用动。
- 上游只有一个(现在是 DeepSeek `deepseek-v4-flash`)。允许的模型在 `ALLOWED_MODELS`,不在名单里的 400。
- 额度单位是 token(input + output)。每把 key 有总额度和每日上限;全站还有一个每日总闸 `GLOBAL_DAILY_TOKENS`。超了回 429,错误体是 OpenAI 风格,`message` 是人话。
- key 手工签发,不开管理接口,没有登录注册。库里只存哈希,明文只在签发时打印一次。
- `GET /v1/me`:这把 key 的余额。`GET /v1/models`:允许的模型。

## 上游密钥

```bash
npx wrangler secret put UPSTREAM_KEY
```

## 常用

```bash
npm install
npm run typecheck
npm run schema                          # 建表(幂等)
npm run deploy
npm run key -- new 张三 --total 5000000 --daily 500000
npm run key -- list
npm run key -- off wk_xxxxxxxx
```

## 用户怎么填

Worktop 设置 → 模型:接口协议 Responses API,接口地址 `https://gateway.iimos.ai/v1/responses`,模型 `deepseek-v4-flash`,密钥填发给他的 `wk_…`。

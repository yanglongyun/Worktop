// /host/* —— 宿主开放给 app 的契约面。**token 即身份**,路径里没有 app id。
//
// 一条原则筛出这几个端点:宿主只提供 app 自己拿不到的东西 —— 模型、agent、产品界面。
// 文件、网络、进程它本来就有,不需要宿主转手。
//
// 两道闸,顺序不能反:先认 token(你是谁),再查 manifest.permissions(你被允许什么)。
import type { IncomingMessage, ServerResponse } from "node:http";
import { complete } from "../ai/complete.js";
import { getSettings } from "../settings.js";
import { emit } from "../bus.js";
import { getApp } from "./registry.js";
import { identifyApp, touchApp } from "./supervisor.js";
import { openTask, recordTaskReply, runAppTask } from "./tasks.js";
import { settleTask } from "./taskStore.js";

import { json, parseBody } from "../http/api/helpers.js";

const bearer = (req: IncomingMessage) =>
  String(req.headers.authorization || "").replace(/^Bearer\s+/i, "").trim();

/** 模型配置。没配齐就返回 null —— app 得到一句人话,而不是一个 500。 */
const runtime = () => {
  const s = getSettings() as any;
  if (!s.apiUrl || !s.apiKey || !s.model) return null;
  return { responsesUrl: s.apiUrl, apiKey: s.apiKey, model: s.model };
};

/** 返回 true = 这个请求已经由 /host/* 处理掉了。 */
export const handleHostRoutes = async (
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
): Promise<boolean> => {
  if (!pathname.startsWith("/host/")) return false;
  const path = pathname.slice("/host".length);

  const appId = identifyApp(bearer(req));
  const app = appId ? getApp(appId) : null;
  if (!app) {
    json(res, 401, { error: "凭证无效。用环境变量 APP_TOKEN,放 Authorization: Bearer。" });
    return true;
  }
  touchApp(app.id); // 调宿主能力也算活着,别在后台干活时被闲置回收

  const need = (permission: string) => {
    if (app.permissions.includes(permission)) return true;
    json(res, 403, { error: `manifest.permissions 里没有声明 ${permission}` });
    return false;
  };
  const method = req.method || "GET";

  try {
    if (method === "GET" && path === "/me") {
      json(res, 200, {
        appId: app.id, name: app.name, version: app.version,
        permissions: app.permissions,
      });
      return true;
    }

    if (method === "POST" && path === "/ai/complete") {
      if (!need("ai.complete")) return true;
      const input = await parseBody(req);
      const prompt = String(input.prompt || "").trim();
      if (!prompt) { json(res, 400, { error: "prompt 不能为空" }); return true; }
      const base = runtime();
      if (!base) {
        json(res, 400, { error: "宿主还没配置模型:先在设置里填接口地址、密钥和模型" });
        return true;
      }
      // 结构化输出:app 传 schema(JSON Schema),走 Responses 原生的格式约束
      let modelOptions: any;
      if (input.schema && typeof input.schema === "object") {
        const name = String(input.schemaName || "result").slice(0, 64);
        modelOptions = { text: { format: { type: "json_schema", name, schema: input.schema, strict: true } } };
      }
      // 补全也是「应用替你干的活」—— 在任务里留一条,一问一答同样进 messages
      const { taskId } = openTask({
        appId: app.id,
        title: String(input.title || "").trim() || prompt,
        prompt,
      });
      try {
        const result: any = await complete({
          ...base,
          modelOptions,
          retry: undefined,
          errorMaxChars: 4000,
          signal: undefined,
          instructions: String(input.instructions || "").slice(0, 4000),
          input: [{ role: "user", content: prompt.slice(0, 150_000) }],
        });
        recordTaskReply(taskId, result.text, result.usage || null);
        settleTask(taskId, "done");
        emit({ type: "tasks_changed" });
        json(res, 200, { text: result.text, usage: result.usage });
      } catch (error: any) {
        settleTask(taskId, "error", String(error?.message || error).slice(0, 4000));
        emit({ type: "tasks_changed" });
        throw error;
      }
      return true;
    }

    if (method === "POST" && path === "/notify") {
      if (!need("notify")) return true;
      const input = await parseBody(req);
      const text = String(input.text || "").trim().slice(0, 300);
      if (!text) { json(res, 400, { error: "text 不能为空" }); return true; }
      emit({
        type: "app_notify",
        appId: app.id, appName: app.name,
        kind: input.kind === "badge" ? "badge" : "toast",
        text,
      });
      json(res, 200, { ok: true });
      return true;
    }

    // 应用触发的完整 agent 轮次:独立任务(tasks 表),不过规则,SSE 流回
    if (method === "POST" && path === "/ai/agent") {
      if (!need("ai.agent")) return true;
      const input = await parseBody(req);
      const prompt = String(input.prompt || "").trim();
      if (!prompt) { json(res, 400, { error: "prompt 不能为空" }); return true; }
      await runAppTask({
        appId: app.id,
        appName: app.name,
        title: String(input.title || "").trim() || prompt,
        prompt,
        cwd: input.cwd ? String(input.cwd) : app.dir,
      }, res);
      return true;
    }

    json(res, 404, { error: `宿主没有这个能力:${path}` });
  } catch (error: any) {
    json(res, error?.status || 500, { error: String(error?.message || error) });
  }
  return true;
};

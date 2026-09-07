// 组件相关 HTTP 端点(宿主侧)。组件自己的 /widgets/* 不在这里 —— 那是组件站点同源应答的
// (见 server/widgets/site.ts),这样宿主能力才与挂载方式正交。
import http from "http";
import { getWidget, listWidgets, trashWidget } from "../../widgets/registry.js";
import { closeWidgetDb } from "../../widgets/db.js";
import { closeWidgetSite, listWidgetSites, resolveWidgetConfirm, widgetSitePort } from "../../widgets/site.js";
import { emit } from "../../bus.js";

import { json, parseBody } from "./helpers.js";

/** 已处理返回 true;未命中返回 false 让 index 继续。 */
export const handleWidgetsRoutes = async (
  req: http.IncomingMessage,
  res: http.ServerResponse,
  url: URL,
  method: string,
): Promise<boolean> => {
  if (url.pathname === "/api/widgets" && method === "GET") {
    json(res, 200, { ok: true, widgets: listWidgets().map(({ dir: _d, ...rest }) => rest) });
    return true;
  }

  /** 组件的地址 —— 每组件一个 loopback 端口,也就是一个真 origin。 */
  if (url.pathname === "/api/widgets/url" && method === "GET") {
    const id = String(url.searchParams.get("id") || "").toLowerCase();
    if (!getWidget(id)) { json(res, 404, { ok: false, error: "组件不存在" }); return true; }
    const port = await widgetSitePort(id);
    if (!port) { json(res, 503, { ok: false, error: "组件站点起不来(端口分配失败)" }); return true; }
    json(res, 200, { ok: true, url: `http://127.0.0.1:${port}/` });
    return true;
  }

  /** 组件 confirm 的回执:界面把用户的选择送回来。 */
  if (url.pathname === "/api/widgets/confirm/result" && method === "POST") {
    const body = await parseBody(req);
    const found = resolveWidgetConfirm(String(body?.requestId || ""), Boolean(body?.ok));
    json(res, found ? 200 : 404, { ok: found });
    return true;
  }

  /** 卸载 = 挪进回收站(保留 30 天),同时收掉端口与数据库句柄。 */
  if (url.pathname === "/api/widgets/remove" && method === "POST") {
    try {
      const body = await parseBody(req);
      const id = String(body?.id || "").toLowerCase();
      if (!getWidget(id)) throw new Error("组件不存在");
      closeWidgetDb(id);
      closeWidgetSite(id);
      const trashed = trashWidget(id);
      emit({ type: "widgets_changed", reason: "removed", id });
      json(res, 200, { ok: true, trashed });
    } catch (e: any) {
      json(res, 400, { ok: false, error: String(e?.message || e) });
    }
    return true;
  }

  if (url.pathname === "/api/widgets/sites" && method === "GET") {
    json(res, 200, { ok: true, sites: listWidgetSites() });
    return true;
  }

  return false;
};

// HTTP 路由按功能模块分发，业务逻辑留在领域服务中。
import type { IncomingMessage, ServerResponse } from "node:http";
import { json } from "./helpers.js";
import { handleChatsRoutes } from "./chats.js";
import { handleFileRoutes } from "./files.js";
import { handleBrowserRoutes } from "./browser.js";
import { handleAppsRoutes } from "./apps.js";
import { handleWidgetsRoutes } from "./widgets.js";
import { handleSkillsRoutes } from "./skills.js";
import { handleSettingsRoutes } from "./settings.js";
import { handleSystemRoutes } from "./system.js";
import { handleGitRoutes } from "./git.js";
import { handleAppHostRoutes } from "../../apps/bridge.js";

type Route = (req: IncomingMessage, res: ServerResponse, url: URL, method: string) => Promise<boolean>;
const ROUTES: Record<string, Route> = {
  chats: handleChatsRoutes, files: handleFileRoutes, browser: handleBrowserRoutes,
  apps: handleAppsRoutes, widgets: handleWidgetsRoutes, skills: handleSkillsRoutes,
  settings: handleSettingsRoutes, system: handleSystemRoutes, git: handleGitRoutes,
};

export const handleApi = async (req: IncomingMessage, res: ServerResponse): Promise<true | null> => {
  const url = new URL(req.url || "/", "http://127.0.0.1");
  const path = url.pathname;
  const method = String(req.method || "GET").toUpperCase();
  try {
    if (path === "/health") { json(res, 200, { ok: true }); return true; }
    if (path === "/api" || path.startsWith("/api/")) {
      const module = path.split("/")[2];
      const route = Object.hasOwn(ROUTES, module) ? ROUTES[module] : undefined;
      if (route && await route(req, res, url, method)) return true;
      json(res, 404, { ok: false, error: "Not found" });
      return true;
    }
    if (await handleAppHostRoutes(req, res, path)) return true;
    return null;
  } catch (error: any) {
    json(res, 500, { ok: false, error: String(error?.message || error) });
    return true;
  }
};

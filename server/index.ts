import http from "http";
import { handleApi } from "./http/api/index.js";
import { attachWs } from "./http/ws.js";
import { serve } from "./http/static.js";
import { startWatcher } from "./files/watcher.js";
import { isTrustedHost, isTrustedOrigin } from "./http/origin.js";
import { track } from "./telemetry.js";
import { seedPresetWidgets, sweepTrash } from "./widgets/registry.js";
import { seedPresetSkills } from "./skills/registry.js";
import { startWidgetSiteSweeper } from "./widgets/site.js";
import { seedPresetApps, watchApps } from "./apps/registry.js";
import { startAlwaysApps } from "./apps/supervisor.js";

const startServer = async (port = 9506) =>
  new Promise((resolve, reject) => {
    const server = http.createServer(async (req, res) => {
      // 第一道闸:Host 必须是回环。防 DNS rebinding —— 挡住把域名重绑到 127.0.0.1 后
      // 用 GET 读走对话/文件的恶意网页(对所有方法生效,含 GET)。
      if (!isTrustedHost(req.headers.host)) {
        res.writeHead(403, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ ok: false, error: "forbidden host" }));
        return;
      }
      // 第二道闸:带副作用的方法(非 GET/HEAD)必须来自应用自身,挡住恶意网页的跨源写。
      const method = String(req.method || "GET").toUpperCase();
      if (method !== "GET" && method !== "HEAD" && !isTrustedOrigin(req.headers.origin, port)) {
        res.writeHead(403, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ ok: false, error: "forbidden origin" }));
        return;
      }
      const result = await handleApi(req, res);
      if (result === null) {
        const url = new URL(req.url || "/", "http://127.0.0.1");
        serve(res, url.pathname);
      }
    });
    attachWs(server, port);
    server.listen(port, "127.0.0.1", () => {
      startWatcher(); // 常用目录文件监听:磁盘上的任何变化 → 树自动刷新
      track("app_open"); // 匿名遥测(仅打包应用;设置可关,见 telemetry.ts)
      seedPresetApps();  // 出厂应用落地到应用的家 —— 之后就是用户自己的 app
      seedPresetWidgets();
      seedPresetSkills();   // 出厂技能落地到 ~/.worktop/skills —— 之后就是用户自己的文件 // 预装组件落地到组件的家 —— 之后就是用户自己的组件(可改可删)
      sweepTrash();        // 回收站里躺满 30 天的真删
      startWidgetSiteSweeper(); // 组件站点闲置回收
      watchApps();              // 应用目录监听:AI 刚写完一个 app,刷新就出现在列表里
      void startAlwaysApps();   // run.mode: "always" 的应用随宿主拉起(其余按需)
      console.log(`Worktop running on http://127.0.0.1:${port}`);
      resolve(server);
    });
    server.on("error", reject);
  });

export { startServer };

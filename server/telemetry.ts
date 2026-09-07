// 匿名遥测:一台安装一个随机 id,开机打一次 app_open。
//
// 三条铁律:
//   1. 只在打包应用里发(壳注入 WORKTOP_PACKAGED=1;开发态零打点);
//   2. 设置里可关(telemetry = "off");
//   3. 只收四个字段 —— 事件名、版本、平台架构、匿名安装 id,不碰任何内容数据。
// 打点永不影响主流程:全链路 catch,8 秒超时,发丢了就丢了。
import { randomUUID } from "crypto";
import { getDb } from "./database/connection.js";
import { getSettings } from "./settings/store.js";

const API = "https://api.worktop.iimos.ai/t";

const installId = () => {
  const db = getDb();
  const row = db.prepare("SELECT value FROM settings WHERE key = 'install_id'").get();
  if (row?.value) return row.value;
  const id = randomUUID();
  db.prepare("INSERT INTO settings (key, value) VALUES ('install_id', ?)").run(id);
  return id;
};

const track = (event: string) => {
  if (process.env.WORKTOP_PACKAGED !== "1") return;
  try {
    if (getSettings().telemetry === "off") return;
    fetch(API, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        e: String(event || "ping"),
        v: process.env.WORKTOP_VERSION || "0.0.0",
        os: `${process.platform}-${process.arch}`,
        id: installId(),
      }),
      signal: AbortSignal.timeout(8000),
    }).catch(() => {});
  } catch { /* 遥测永不拖垮启动 */ }
};

export { track };

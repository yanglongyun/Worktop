// 网站图标:优先页面上报的真实 favicon(Electron webview 的 page-favicon-updated),
// 退 /api/browser/favicon 代理(server 直连站点抓取+缓存,不依赖第三方服务),再退 Globe。
import { useEffect, useState } from "react";
import { Globe } from "./icons";

export function Favicon({ url, override, size = 14, className = "" }: {
  /** 页面地址(代理按它的 origin 抓图标)。 */
  url: string;
  /** 已知的图标地址(页面自己上报的),有就先用它。 */
  override?: string;
  size?: number;
  className?: string;
}) {
  const candidates = [override, url ? `/api/browser/favicon?url=${encodeURIComponent(url)}` : ""].filter(Boolean) as string[];
  const [idx, setIdx] = useState(0);
  useEffect(() => { setIdx(0); }, [override, url]);

  if (!candidates.length || idx >= candidates.length) {
    return <Globe size={size} className={`shrink-0 text-accent ${className}`} />;
  }
  return (
    <img
      key={candidates[idx]}
      src={candidates[idx]}
      width={size}
      height={size}
      onError={() => setIdx((i) => i + 1)}
      draggable={false}
      alt=""
      className={`shrink-0 rounded-[3px] object-contain ${className}`}
      style={{ width: size, height: size }}
    />
  );
}

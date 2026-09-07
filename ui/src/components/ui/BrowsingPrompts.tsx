// 内置浏览器抛上来的三种问询:网站权限、HTTP 认证、证书错误。
//
// 挂一份就够,和 DialogHost 一样住在 App 根上 —— 这三件都是**全局**的
// (session 级,不属于某个标签页),挂进 WebPanel 的话分屏时会同时冒出两份。
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, Key, ShieldAlert } from "./icons";

type Permission = { id: string; origin: string; permission: string };
type Auth = { id: string; host: string; realm: string; isProxy: boolean };
type Cert = { host: string; reason: string };

/** 权限的人话。认不出的原样显示 —— 编一个好听的名字反而让人不知道自己批准了什么。 */
const PERMISSION_LABEL: Record<string, string> = {
  media: "使用摄像头或麦克风",
  geolocation: "获取你的位置",
  notifications: "发送通知",
  midi: "访问 MIDI 设备",
  midiSysex: "访问 MIDI 设备",
  hid: "访问 USB 输入设备",
  serial: "访问串口设备",
  usb: "访问 USB 设备",
};

const answer = (id: string, value: unknown) => {
  void window.worktopDesktop?.answerWebPrompt(id, value);
};

export function BrowsingPrompts() {
  const [permission, setPermission] = useState<Permission | null>(null);
  const [auth, setAuth] = useState<Auth | null>(null);
  const [cert, setCert] = useState<Cert | null>(null);
  const [user, setUser] = useState("");
  const [pass, setPass] = useState("");

  useEffect(() => {
    const onPermission = (e: Event) => setPermission((e as CustomEvent).detail);
    const onAuth = (e: Event) => { setUser(""); setPass(""); setAuth((e as CustomEvent).detail); };
    const onCert = (e: Event) => setCert((e as CustomEvent).detail);
    window.addEventListener("worktop:web-permission", onPermission);
    window.addEventListener("worktop:web-auth", onAuth);
    window.addEventListener("worktop:web-cert-error", onCert);
    return () => {
      window.removeEventListener("worktop:web-permission", onPermission);
      window.removeEventListener("worktop:web-auth", onAuth);
      window.removeEventListener("worktop:web-cert-error", onCert);
    };
  }, []);

  if (!permission && !auth && !cert) return null;

  return createPortal(
    <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/25 px-4">
      {permission && (
        <Card
          icon={<ShieldAlert size={18} className="text-warning" />}
          title={`${new URL(permission.origin).host} 想要`}
          body={PERMISSION_LABEL[permission.permission] || permission.permission}
          note="允许后同一个站不再重复询问;可在设置里清空。"
          actions={[
            { label: "拒绝", onClick: () => { answer(permission.id, false); setPermission(null); } },
            { label: "允许", primary: true, onClick: () => { answer(permission.id, true); setPermission(null); } },
          ]}
        />
      )}

      {!permission && auth && (
        <Card
          icon={<Key size={18} className="text-accent" />}
          title={`${auth.isProxy ? "代理" : auth.host} 要求登录`}
          body={auth.realm ? `身份区域:${auth.realm}` : "这个站点使用 HTTP 认证"}
          note="凭证只用于这一次连接,不会保存。"
          fields={
            <div className="mt-3 space-y-2">
              <input
                autoFocus value={user} onChange={(e) => setUser(e.target.value)}
                placeholder="用户名"
                className="w-full h-9 px-3 rounded-lg border border-border bg-bg text-[13px] text-text outline-none focus:border-accent"
              />
              <input
                type="password" value={pass} onChange={(e) => setPass(e.target.value)}
                placeholder="密码"
                onKeyDown={(e) => {
                  if (e.key !== "Enter" || !user) return;
                  answer(auth.id, { username: user, password: pass });
                  setAuth(null);
                }}
                className="w-full h-9 px-3 rounded-lg border border-border bg-bg text-[13px] text-text outline-none focus:border-accent"
              />
            </div>
          }
          actions={[
            { label: "取消", onClick: () => { answer(auth.id, null); setAuth(null); } },
            {
              label: "登录", primary: true, disabled: !user,
              onClick: () => { answer(auth.id, { username: user, password: pass }); setAuth(null); },
            },
          ]}
        />
      )}

      {!permission && !auth && cert && (
        <Card
          icon={<AlertTriangle size={18} className="text-danger" />}
          title={`${cert.host} 的证书无效`}
          body={cert.reason || "证书无法验证"}
          note="自签名或过期的证书常见于内网系统与本地服务。确认这是你信任的地址再继续。"
          actions={[
            { label: "返回", onClick: () => setCert(null) },
            {
              label: "仍要继续", danger: true,
              onClick: () => {
                void window.worktopDesktop?.trustCertHost(cert.host);
                setCert(null);
                // 信任是这次运行内的事,重载后才会生效
                window.dispatchEvent(new CustomEvent("worktop:reload-web", { detail: { host: cert.host } }));
              },
            },
          ]}
        />
      )}
    </div>,
    document.body,
  );
}

type Action = { label: string; onClick: () => void; primary?: boolean; danger?: boolean; disabled?: boolean };

function Card({ icon, title, body, note, fields, actions }: {
  icon: React.ReactNode; title: string; body: string; note: string;
  fields?: React.ReactNode; actions: Action[];
}) {
  return (
    <div className="w-full max-w-[400px] rounded-2xl border border-border bg-surface shadow-2xl p-5">
      <div className="flex items-start gap-3">
        <span className="shrink-0 mt-0.5">{icon}</span>
        <div className="min-w-0 flex-1">
          <div className="text-[15px] font-medium text-text leading-snug">{title}</div>
          <div className="mt-1 text-[13px] text-text-dim break-all">{body}</div>
          {fields}
          <div className="mt-2.5 text-[11.5px] text-text-faint leading-relaxed">{note}</div>
        </div>
      </div>
      <div className="mt-4 flex items-center justify-end gap-2.5">
        {actions.map((action) => (
          <button
            key={action.label}
            onClick={action.onClick}
            disabled={action.disabled}
            className={[
              "h-9 px-4 rounded-xl text-[13.5px] transition-colors disabled:opacity-40",
              action.primary ? "bg-text text-bg font-medium hover:opacity-90"
                : action.danger ? "bg-danger text-white hover:opacity-90"
                  : "bg-bg-inset text-text hover:bg-bg-hover",
            ].join(" ")}
          >
            {action.label}
          </button>
        ))}
      </div>
    </div>
  );
}

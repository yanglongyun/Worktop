import type { Settings } from "../../api";

export type ModelConnection = Pick<Settings, "apiUrl" | "apiKey" | "model">;
export const settingsInputClass = "w-full border border-border bg-bg px-3 py-2 text-[13px] font-normal text-text outline-none transition-colors placeholder:text-text-faint focus:border-accent disabled:opacity-50";

export function ModelConnectionFields({ value, onChange, disabled = false, autoFocus = false, rows = false }: {
  value: ModelConnection;
  onChange: (key: keyof ModelConnection, value: string) => void;
  disabled?: boolean;
  autoFocus?: boolean;
  rows?: boolean;
}) {
  return <div className="space-y-4">
    {([
      ["apiUrl", "接口地址", "https://your-provider.com/v1/responses"],
      ["apiKey", "API 密钥", "输入密钥（无须鉴权时可留空）"],
      ["model", "模型名称", "输入服务商提供的模型名称"],
    ] as const).map(([key, label, placeholder]) => <label key={key} className={rows ? "grid grid-cols-[140px_minmax(0,1fr)] items-center gap-4 text-[12px] text-text-dim @max-[640px]:grid-cols-1 @max-[640px]:gap-2" : "block text-[12px] font-medium text-text-dim"}>
      <span>{label}</span>
      <input className={`${rows ? "" : "mt-1.5"} ${settingsInputClass}`} name={key}
        autoFocus={autoFocus && key === "apiUrl"} required={key !== "apiKey"}
        type={key === "apiKey" ? "password" : key === "apiUrl" ? "url" : "text"}
        autoComplete="off" spellCheck={false} disabled={disabled}
        value={value[key]} placeholder={placeholder} onChange={(e) => onChange(key, e.target.value)} />
    </label>)}
  </div>;
}

import { type ApprovalCard as Card, chatsApi } from "../../api/chats";
// 提醒卡:助手自己觉得该问一句,停在这儿等你表态。
//
// 它长在对话流里,不做浮层 —— 调用停在哪儿,卡就出现在哪儿,你能看见上下文里助手正在干什么。
// 出口只有两个:不允许 / 允许。没有「以后都允许」。
// 它是助手的判断,不是保证:界面不许让人以为「危险操作它一定会问」。
import { useState } from "react";
import { AlertTriangle, Check, MessageCircleQuestion, X } from "lucide-react";

export function ApprovalCard({ card, onDone }: { card: Card; onDone: (id: string) => void }) {
  const [busy, setBusy] = useState(false);
  const answer = (value: "allow" | "deny") => {
    setBusy(true);
    void chatsApi.respondApproval(card.id, value).then(() => onDone(card.id)).catch(() => setBusy(false));
  };
  return (
    <div className="w-full max-w-2xl rounded-xl border border-accent/40 bg-accent/[0.04] overflow-hidden">
      <div className="flex items-start gap-2.5 px-4 pt-3.5 pb-2">
        <MessageCircleQuestion size={16} className="shrink-0 mt-0.5 text-accent" />
        <div className="min-w-0 flex-1">
          <div className="mb-1 text-[11px] font-medium text-accent">助手提醒</div>
          <div className="text-[14px] text-text leading-snug">{card.summary}</div>
        </div>
      </div>
      {card.detail && (
        <pre className="mx-4 mb-2 px-3 py-2 rounded-lg bg-bg-panel text-[12px] font-mono text-text-dim leading-relaxed whitespace-pre-wrap break-all select-text max-h-[132px] overflow-y-auto">
          {card.detail}
        </pre>
      )}
      {card.risk && (
        <div className="px-4 pb-2.5 flex items-start gap-1.5 text-[12px] text-text-faint">
          <AlertTriangle size={11} className="shrink-0 mt-[3px]" />
          <span className="min-w-0">{card.risk}</span>
        </div>
      )}
      <div className="flex items-center gap-2 px-4 py-2.5 border-t border-accent/20 bg-accent/[0.03]">
        <button
          onClick={() => answer("deny")}
          disabled={busy}
          className="inline-flex items-center gap-1 h-7 px-3 rounded-md text-[12.5px] text-text-dim hover:bg-bg-hover disabled:opacity-40 transition-colors"
        >
          <X size={13} /> 不允许
        </button>
        <button
          onClick={() => answer("allow")}
          disabled={busy}
          className="ml-auto inline-flex items-center gap-1 h-7 px-3 rounded-md bg-accent text-white text-[12.5px] hover:opacity-90 disabled:opacity-40 transition-opacity"
        >
          <Check size={13} /> 允许这一次
        </button>
      </div>
    </div>
  );
}

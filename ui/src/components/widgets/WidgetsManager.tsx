import { widgetsApi } from "../../api/widgets";
// 组件管理(标签页)。侧栏那 260px 只够列个名字;管理是「摊开来看」的事 ——
// 每个组件一张卡:图标、名字、说明、权限、装在哪、钉/取下、删除。
import { useEffect, useState } from "react";
import { LayoutGrid, Sparkles, Trash2 } from "lucide-react";
import { dialog } from "../ui";
import { dropFromOrder, requestCreateWidget } from "../../lib/widgetOrder";
import type { WidgetDef } from "../sidebar/registry";

const PERMISSION_LABEL: Record<string, string> = {
  sql: "数据库",
  ai: "调用 AI",
  ui: "界面提示",
};

export function WidgetsManager() {
  const [widgets, setWidgets] = useState<WidgetDef[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = () => widgetsApi.listWidgets()
    .then((list) => setWidgets(list as WidgetDef[]))
    .catch(() => {})
    .finally(() => setLoading(false));

  // 组件是目录,可能被 AI 或用户在文件系统里直接加出来 —— 每次进这个标签都重拉一次
  useEffect(() => { void reload(); }, []);

  const remove = async (widget: WidgetDef) => {
    const ok = await dialog.confirm(
      `删除组件「${widget.name}」?\n目录 widgets/${widget.id}/(含数据 data.db)会移进回收站,30 天后清除。`,
      { danger: true, confirmText: "删除" },
    );
    if (!ok) return;
    try { await widgetsApi.removeWidget(widget.id); } catch (e: any) { void dialog.alert(e?.message || "删除失败"); return; }
    dropFromOrder(widget.id);
    void reload();
  };

  return (
    <div className="flex-1 min-h-0 overflow-y-auto bg-bg">
      <div className="mx-auto w-full max-w-4xl px-5 md:px-8 py-6">
        <div className="flex items-center gap-3 pb-4 border-b border-border">
          <LayoutGrid size={18} className="shrink-0 text-accent" />
          <div className="flex-1 min-w-0">
            <h1 className="text-[17px] font-semibold text-text">组件</h1>
            <p className="mt-0.5 text-[12.5px] text-text-faint">
零构建的小工具,一个目录即一个组件。装好就出现在侧栏「小组件」面板里。
            </p>
          </div>
          <button
            onClick={requestCreateWidget}
            className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-accent text-white text-[13px] hover:opacity-90 transition-opacity"
          >
            <Sparkles size={14} /> 让 AI 创建
          </button>
        </div>

        {loading ? (
          <div className="py-16 text-center text-[13px] text-text-faint">读取中…</div>
        ) : !widgets.length ? (
          <div className="py-16 text-center">
            <div className="text-[14px] text-text-dim">还没有组件</div>
            <div className="mt-1.5 text-[12.5px] text-text-faint leading-relaxed">
可让 AI 创建,或手动新建目录并放入 widget.json 与 index.html
            </div>
          </div>
        ) : (
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {widgets.map((widget) => {
              return (
                <div
                  key={widget.id}
                  className="group flex flex-col p-3.5 rounded-lg border border-border bg-surface hover:border-accent/40 transition-colors"
                >
                  {/* 顶行:图标 + 名字。装了就在小组件面板里,没有显示开关 */}
                  <div className="flex items-center gap-3">
                    <span className="shrink-0 w-9 h-9 rounded-md bg-bg-panel flex items-center justify-center text-[19px] leading-none">
                      {widget.icon}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[14px] font-medium text-text">{widget.name}</span>
                  </div>

                  {widget.description && (
                    <div className="mt-2 text-[12px] text-text-dim leading-relaxed line-clamp-2">{widget.description}</div>
                  )}

                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    <code className="px-1.5 py-0.5 rounded bg-bg-panel text-[11px] font-mono text-text-faint">
                      widgets/{widget.id}/
                    </code>
                    {widget.permissions?.map((p) => (
                      <span key={p} className="px-1.5 py-0.5 rounded bg-accent-soft text-[11px] text-accent">
                        {PERMISSION_LABEL[p] || p}
                      </span>
                    ))}
                    <button
                      onClick={() => void remove(widget)}
                      title="删除组件"
                      className="ml-auto w-6 h-6 rounded flex items-center justify-center text-text-faint opacity-0 group-hover:opacity-100 hover:text-danger hover:bg-bg-hover transition-all"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

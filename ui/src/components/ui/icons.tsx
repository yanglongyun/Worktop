import type { ComponentProps, ReactNode } from "react";

/** Worktop 自绘图标：24 × 24 画布，1.6px 线宽，圆线帽，颜色随文本。 */
export type IconProps = Omit<ComponentProps<"svg">, "children"> & { size?: number | string };

function createIcon(name: string, drawing: ReactNode) {
  function Icon({ size = 24, strokeWidth = 1.6, ...props }: IconProps) {
    const labelled = Boolean(props["aria-label"] || props["aria-labelledby"]);
    return (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden={labelled ? undefined : true}
        role={labelled ? "img" : undefined}
        focusable="false"
        {...props}
      >
        {drawing}
      </svg>
    );
  }
  Icon.displayName = name;
  return Icon;
}

// 文件：相同的纸张与折角，内容标识放在下半部。
const sheet = <path d="M5 3.5h9l5 5v12H5Z M14 3.5v5h5" />;
const folder = <path d="M3 7V5h6l2 2h10v13H3Z" />;
const shield = <path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6Z" />;
const settings = <><path d="m9 3 6 0 1 3 3 1 2 5-2 5-3 1-1 3H9l-1-3-3-1-2-5 2-5 3-1 1-3Z" /><circle cx="12" cy="12" r="3" /></>;

export const FileText = /* @__PURE__ */ createIcon("FileText", <>{sheet}<path d="M8 12h8 M8 16h6" /></>);
export const FileCode = /* @__PURE__ */ createIcon("FileCode", <>{sheet}<path d="m10 12-2.5 2.5L10 17 m4-5 2.5 2.5L14 17" /></>);
export const FileJson = /* @__PURE__ */ createIcon("FileJson", <>{sheet}<path d="M10 11.5H9v2l-1 1 1 1v2h1 M14 11.5h1v2l1 1-1 1v2h-1" /></>);
export const FileType = /* @__PURE__ */ createIcon("FileType", <>{sheet}<path d="M8.5 12h7 M12 12v5 M10.5 17h3" /></>);
export const FileQuestion = /* @__PURE__ */ createIcon("FileQuestion", <>{sheet}<path d="M10 12.5a2 2 0 1 1 3.2 1.6c-.8.5-1.2.8-1.2 1.4" /><circle cx="12" cy="18" r=".65" fill="currentColor" stroke="none" /></>);
export const FilePlus = /* @__PURE__ */ createIcon("FilePlus", <>{sheet}<path d="M8.5 14.5h7 M12 11v7" /></>);
export const Files = /* @__PURE__ */ createIcon("Files", sheet);
export const Folder = /* @__PURE__ */ createIcon("Folder", folder);
export const FolderPlus = /* @__PURE__ */ createIcon("FolderPlus", <>{folder}<path d="M9 13.5h6 M12 10.5v6" /></>);
export const FolderOpen = /* @__PURE__ */ createIcon("FolderOpen", <path d="M3 19.5V5h6l2 2h9v4 M3 19.5l3-8h16l-3 8Z" />);
export const Image = /* @__PURE__ */ createIcon("Image", <><rect x="3" y="4" width="18" height="16" rx="1" /><circle cx="8" cy="9" r="1.5" /><path d="m3 17 5-4 4 3 4-6 5 6" /></>);
export const Hash = /* @__PURE__ */ createIcon("Hash", <path d="m9 3-2 18 M17 3l-2 18 M4 8h17 M3 16h17" />);
export const Code = /* @__PURE__ */ createIcon("Code", <path d="m7 6-5 6 5 6 M17 6l5 6-5 6 M14 4l-4 16" />);

// 主要入口：收敛细节，在活动栏与小尺寸标签中保持辨识度。
export const MessageSquare = /* @__PURE__ */ createIcon("MessageSquare", <path d="M5 4h14a2 2 0 0 1 2 2v11H8l-5 4V6a2 2 0 0 1 2-2Z" />);
export const Bot = /* @__PURE__ */ createIcon("Bot", <><rect x="4" y="7" width="16" height="13" rx="2" /><path d="M12 3v4 M1.5 12v4 M22.5 12v4 M8.5 12v3 M15.5 12v3" /></>);
export const Globe = /* @__PURE__ */ createIcon("Globe", <><circle cx="12" cy="12" r="9" /><path d="M3 12h18 M12 3c5 5 5 13 0 18-5-5-5-13 0-18Z" /></>);
export const LayoutGrid = /* @__PURE__ */ createIcon("LayoutGrid", <><rect x="3" y="3" width="7" height="7" rx=".5" /><rect x="14" y="3" width="7" height="7" rx=".5" /><rect x="3" y="14" width="7" height="7" rx=".5" /><rect x="14" y="14" width="7" height="7" rx=".5" /></>);
export const Terminal = /* @__PURE__ */ createIcon("Terminal", <path d="m4 5 6 6-6 6 M13 18h7" />);
export const AppWindow = /* @__PURE__ */ createIcon("AppWindow", <><rect x="3" y="4" width="18" height="16" rx="1" /><path d="M3 9h18" /><circle cx="6" cy="6.5" r=".6" fill="currentColor" stroke="none" /><circle cx="9" cy="6.5" r=".6" fill="currentColor" stroke="none" /></>);
export const PanelLeft = /* @__PURE__ */ createIcon("PanelLeft", <><rect x="3" y="4" width="18" height="16" rx=".5" /><path d="M9 4v16" /></>);
export const PanelRight = /* @__PURE__ */ createIcon("PanelRight", <><rect x="3" y="4" width="18" height="16" rx=".5" /><path d="M15 4v16" /></>);
export const Columns = /* @__PURE__ */ createIcon("Columns", <><rect x="3" y="4" width="18" height="16" rx=".5" /><path d="M12 4v16" /></>);
export const Settings = /* @__PURE__ */ createIcon("Settings", settings);
export const SlidersHorizontal = /* @__PURE__ */ createIcon("SlidersHorizontal", <><path d="M3 6h3 M11 6h10 M3 12h10 M18 12h3 M3 18h3 M11 18h10" /><rect x="6" y="3.5" width="5" height="5" rx="1" /><rect x="13" y="9.5" width="5" height="5" rx="1" /><rect x="6" y="15.5" width="5" height="5" rx="1" /></>);
export const Activity = /* @__PURE__ */ createIcon("Activity", <path d="M2 13h5l3-9 4 16 3-7h5" />);
export const Puzzle = /* @__PURE__ */ createIcon("Puzzle", <path d="M9 4H4v6c4-2 4 5 0 3v7h6c-2-4 5-4 3 0h7v-6c4 2 4-5 0-3V4h-6c2-4-5-4-3 0Z" />);
export const Sparkles = /* @__PURE__ */ createIcon("Sparkles", <><path d="m10 5 2.2 5.8L18 13l-5.8 2.2L10 21l-2.2-5.8L2 13l5.8-2.2Z M19 2v5 M16.5 4.5h5" /></>);

// 方向与操作：等长主轴，统一箭头开口和留白。
export const Plus = /* @__PURE__ */ createIcon("Plus", <path d="M12 4v16 M4 12h16" />);
export const Minus = /* @__PURE__ */ createIcon("Minus", <path d="M4 12h16" />);
export const X = /* @__PURE__ */ createIcon("X", <path d="m6 6 12 12 M6 18 18 6" />);
export const Check = /* @__PURE__ */ createIcon("Check", <path d="m5 12 4 4L19 6" />);
export const ChevronRight = /* @__PURE__ */ createIcon("ChevronRight", <path d="m9 5 7 7-7 7" />);
export const ChevronLeft = /* @__PURE__ */ createIcon("ChevronLeft", <path d="m15 5-7 7 7 7" />);
export const ChevronUp = /* @__PURE__ */ createIcon("ChevronUp", <path d="m5 15 7-7 7 7" />);
export const ChevronDown = /* @__PURE__ */ createIcon("ChevronDown", <path d="m5 9 7 7 7-7" />);
export const ChevronsDownUp = /* @__PURE__ */ createIcon("ChevronsDownUp", <path d="m7 3 5 5 5-5 M7 21l5-5 5 5" />);
export const ChevronsUpDown = /* @__PURE__ */ createIcon("ChevronsUpDown", <path d="m7 8 5-5 5 5 M7 16l5 5 5-5" />);
export const ArrowLeft = /* @__PURE__ */ createIcon("ArrowLeft", <path d="M20 12H4 m6-6-6 6 6 6" />);
export const ArrowRight = /* @__PURE__ */ createIcon("ArrowRight", <path d="M4 12h16 m-6-6 6 6-6 6" />);
export const ArrowUpCircle = /* @__PURE__ */ createIcon("ArrowUpCircle", <><circle cx="12" cy="12" r="9" /><path d="M12 17V7 m-4 4 4-4 4 4" /></>);
export const ExternalLink = /* @__PURE__ */ createIcon("ExternalLink", <path d="M10 4H4v16h16v-6 M14 3h7v7 M21 3 11 13" />);
export const Search = /* @__PURE__ */ createIcon("Search", <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m15.5 15.5 5 5" /></>);
export const Pencil = /* @__PURE__ */ createIcon("Pencil", <path d="m4 16 12-12 4 4L8 20H4Z M13.5 6.5l4 4" />);
export const Copy = /* @__PURE__ */ createIcon("Copy", <><rect x="8" y="8" width="12" height="13" rx="1" /><path d="M15 4H4v12" /></>);
export const ClipboardPaste = /* @__PURE__ */ createIcon("ClipboardPaste", <><path d="M8 4H4v16h6 M16 4h4v5" /><rect x="8" y="2.5" width="8" height="4" rx="1" /><rect x="13" y="12" width="8" height="10" rx=".5" /></>);
export const Scissors = /* @__PURE__ */ createIcon("Scissors", <><circle cx="6" cy="6" r="3" /><circle cx="6" cy="18" r="3" /><path d="m8 8 12 13 M8 16 20 3" /></>);
export const Trash = /* @__PURE__ */ createIcon("Trash", <path d="M3.5 6h17 M9 6V3h6v3 M6 6l1 15h10l1-15 M10 10v7 M14 10v7" />);
export const Download = /* @__PURE__ */ createIcon("Download", <path d="M12 3v12 m-5-5 5 5 5-5 M4 16v5h16v-5" />);
export const Upload = /* @__PURE__ */ createIcon("Upload", <path d="M12 16V4 m-5 5 5-5 5 5 M4 16v5h16v-5" />);
export const UploadCloud = /* @__PURE__ */ createIcon("UploadCloud", <><path d="M6 17H5a4 4 0 0 1-.5-8A7 7 0 0 1 18 7a5 5 0 0 1 1 10h-1 M12 21V11 m-4 4 4-4 4 4" /></>);
export const MoreHorizontal = /* @__PURE__ */ createIcon("MoreHorizontal", <g fill="currentColor" stroke="none"><circle cx="5" cy="12" r="1.5" /><circle cx="12" cy="12" r="1.5" /><circle cx="19" cy="12" r="1.5" /></g>);
export const MoreVertical = /* @__PURE__ */ createIcon("MoreVertical", <g fill="currentColor" stroke="none"><circle cx="12" cy="5" r="1.5" /><circle cx="12" cy="12" r="1.5" /><circle cx="12" cy="19" r="1.5" /></g>);
export const GripVertical = /* @__PURE__ */ createIcon("GripVertical", <g fill="currentColor" stroke="none"><circle cx="8" cy="5" r="1.2" /><circle cx="16" cy="5" r="1.2" /><circle cx="8" cy="12" r="1.2" /><circle cx="16" cy="12" r="1.2" /><circle cx="8" cy="19" r="1.2" /><circle cx="16" cy="19" r="1.2" /></g>);
export const Pin = /* @__PURE__ */ createIcon("Pin", <path d="M9 3h6l-1 6 4 4v2H6v-2l4-4Z M12 15v7" />);
export const PinOff = /* @__PURE__ */ createIcon("PinOff", <path d="M9 3h6l-1 6 3 3 M8.5 10.5 6 13v2h9 M12 15v7 M3 3l18 18" />);
export const Star = /* @__PURE__ */ createIcon("Star", <path d="m12 2.5 2.9 6 6.6.9-4.8 4.7 1.2 6.6-5.9-3.1-5.9 3.1 1.2-6.6-4.8-4.7 6.6-.9Z" />);
export const Paperclip = /* @__PURE__ */ createIcon("Paperclip", <path d="m9 12 6-6a3 3 0 0 1 4 4l-9 9a5 5 0 0 1-7-7l9-9" />);
export const Send = /* @__PURE__ */ createIcon("Send", <path d="m21 3-6 18-4-8-8-4 18-6Z M11 13 21 3" />);
export const Play = /* @__PURE__ */ createIcon("Play", <path d="m7 3 14 9-14 9Z" />);
export const Square = /* @__PURE__ */ createIcon("Square", <rect x="5" y="5" width="14" height="14" rx="1" />);
export const Circle = /* @__PURE__ */ createIcon("Circle", <circle cx="12" cy="12" r="8" />);
export const Loader = /* @__PURE__ */ createIcon("Loader", <path d="M12 3a9 9 0 1 1-9 9" />);
export const RotateCw = /* @__PURE__ */ createIcon("RotateCw", <path d="M20 9a8.3 8.3 0 1 0 .3 5 M20 3v6h-6" />);
export const RotateCcw = /* @__PURE__ */ createIcon("RotateCcw", <path d="M4 9a8.3 8.3 0 1 1-.3 5 M4 3v6h6" />);
export const RefreshCw = /* @__PURE__ */ createIcon("RefreshCw", <path d="M20 9a8.3 8.3 0 0 0-15-3 M20 3v6h-6 M4 15a8.3 8.3 0 0 0 15 3 M4 21v-6h6" />);
export const History = /* @__PURE__ */ createIcon("History", <><path d="M4 9a8.3 8.3 0 1 1-.3 5 M4 3v6h6 M12 7v6l4 2" /></>);

// 状态、浏览与确认。
export const Shield = /* @__PURE__ */ createIcon("Shield", shield);
export const ShieldCheck = /* @__PURE__ */ createIcon("ShieldCheck", <>{shield}<path d="m8 11 3 3 5-5" /></>);
export const ShieldAlert = /* @__PURE__ */ createIcon("ShieldAlert", <>{shield}<path d="M12 8v5" /><circle cx="12" cy="16" r=".75" fill="currentColor" stroke="none" /></>);
export const AlertTriangle = /* @__PURE__ */ createIcon("AlertTriangle", <><path d="m12 3 10 18H2Z M12 9v5" /><circle cx="12" cy="17.5" r=".75" fill="currentColor" stroke="none" /></>);
export const Info = /* @__PURE__ */ createIcon("Info", <><circle cx="12" cy="12" r="9" /><path d="M11 11h1v6 M10 17h4" /><circle cx="12" cy="7" r=".75" fill="currentColor" stroke="none" /></>);
export const MessageCircleQuestion = /* @__PURE__ */ createIcon("MessageCircleQuestion", <><path d="M21 11.5a8.5 8.5 0 0 1-8.5 8.5H8l-5 2V11.5a9 9 0 0 1 18 0Z M9.5 8.5a2.5 2.5 0 1 1 4 2c-1 .7-1.5 1-1.5 2" /><circle cx="12" cy="16" r=".75" fill="currentColor" stroke="none" /></>);
export const Eye = /* @__PURE__ */ createIcon("Eye", <><path d="M2 12c5-9 15-9 20 0-5 9-15 9-20 0Z" /><circle cx="12" cy="12" r="3" /></>);
export const EyeOff = /* @__PURE__ */ createIcon("EyeOff", <><path d="M9 5.5c5-1.3 10 1.2 13 6.5a17 17 0 0 1-3.5 4.2 M15 18.5C10 19.8 5 17.3 2 12a17 17 0 0 1 3.5-4.2 M10 10a2.8 2.8 0 0 0 4 4 M3 3l18 18" /></>);
export const Key = /* @__PURE__ */ createIcon("Key", <><circle cx="15.5" cy="7.5" r="4.5" /><path d="M12 11 3 20v1h5v-3h3v-3l2-2" /><circle cx="17" cy="6" r=".65" fill="currentColor" stroke="none" /></>);
export const Cookie = /* @__PURE__ */ createIcon("Cookie", <><path d="M12 3a5 5 0 0 0 5 6 4 4 0 0 0 4 4 9 9 0 1 1-9-10Z" /><g fill="currentColor" stroke="none"><circle cx="7.5" cy="9" r="1" /><circle cx="12" cy="13" r="1" /><circle cx="7.5" cy="16" r="1" /><circle cx="15" cy="17" r="1" /></g></>);
export const User = /* @__PURE__ */ createIcon("User", <><circle cx="12" cy="7" r="4" /><path d="M4 21v-2c0-7 16-7 16 0v2" /></>);
export const PhoneCall = /* @__PURE__ */ createIcon("PhoneCall", <><path d="m4 3 4 1 1 5-3 2a16 16 0 0 0 7 7l2-3 5 1 1 4c-8 5-23-10-17-17Z M14 3a7 7 0 0 1 7 7 M14 7a3 3 0 0 1 3 3" /></>);
export const Plug = /* @__PURE__ */ createIcon("Plug", <path d="M8 3v5 M16 3v5 M5 8h14 M6 8v4a6 6 0 0 0 12 0V8 M12 18v4" />);
export const Megaphone = /* @__PURE__ */ createIcon("Megaphone", <path d="M4 9h5l11-6v18L9 15H4Z M9 9v6 M6 15l2 6h4l-2-5" />);

// Git：节点尺寸与分支的转折一致，保留操作本身的区别。
export const GitBranch = /* @__PURE__ */ createIcon("GitBranch", <><circle cx="6" cy="5" r="2.5" /><circle cx="6" cy="19" r="2.5" /><circle cx="18" cy="5" r="2.5" /><path d="M6 7.5v9 M18 7.5v2c0 4-12 2-12 7" /></>);
export const GitCommit = /* @__PURE__ */ createIcon("GitCommit", <><circle cx="12" cy="12" r="4" /><path d="M2 12h6 M16 12h6" /></>);
export const GitCompare = /* @__PURE__ */ createIcon("GitCompare", <><circle cx="6" cy="19" r="2.5" /><circle cx="18" cy="5" r="2.5" /><path d="M6 16.5V4 m-3 3 3-3 3 3 M18 7.5V20 m-3-3 3 3 3-3" /></>);
export const GitPullRequest = /* @__PURE__ */ createIcon("GitPullRequest", <><circle cx="5" cy="5" r="2.5" /><circle cx="5" cy="19" r="2.5" /><circle cx="19" cy="19" r="2.5" /><path d="M5 7.5v9 M19 16.5V9a4 4 0 0 0-4-4h-3 m3-3-3 3 3 3" /></>);

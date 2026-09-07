import { useEffect, useRef, useState } from "react";
import { basicSetup, EditorView } from "codemirror";
import { oneDark } from "@codemirror/theme-one-dark";
import { THEME_EVENT, resolvedTheme } from "../../lib/theme";
import { EditorState } from "@codemirror/state";
import { keymap } from "@codemirror/view";
import { indentWithTab } from "@codemirror/commands";
import { javascript } from "@codemirror/lang-javascript";
import { markdown } from "@codemirror/lang-markdown";
import { json } from "@codemirror/lang-json";
import { html } from "@codemirror/lang-html";
import { css } from "@codemirror/lang-css";
import { python } from "@codemirror/lang-python";
import { yaml } from "@codemirror/lang-yaml";
import { go } from "@codemirror/lang-go";
import { rust } from "@codemirror/lang-rust";
import { sql } from "@codemirror/lang-sql";
import { cpp } from "@codemirror/lang-cpp";
import { java } from "@codemirror/lang-java";
import { php } from "@codemirror/lang-php";
import { xml } from "@codemirror/lang-xml";
import { StreamLanguage } from "@codemirror/language";
import { shell } from "@codemirror/legacy-modes/mode/shell";
import { toml } from "@codemirror/legacy-modes/mode/toml";
import { ruby } from "@codemirror/legacy-modes/mode/ruby";
import { swift } from "@codemirror/legacy-modes/mode/swift";
import { lua } from "@codemirror/legacy-modes/mode/lua";
import { diff as diffMode } from "@codemirror/legacy-modes/mode/diff";
import { kotlin } from "@codemirror/legacy-modes/mode/clike";
import { dockerFile } from "@codemirror/legacy-modes/mode/dockerfile";

// 按文件名挑语言(认不出就纯文本)。编辑器与 diff 视图共用。
export function langFor(filename: string) {
  const base = filename.split("/").pop()?.toLowerCase() || "";
  if (base === "dockerfile" || base.startsWith("dockerfile.")) return StreamLanguage.define(dockerFile);
  if (base === "makefile") return StreamLanguage.define(shell);
  const ext = base.split(".").pop() || "";
  switch (ext) {
    case "js": case "jsx": case "mjs": case "cjs": return javascript({ jsx: true });
    case "ts": case "tsx": case "mts": case "cts": return javascript({ jsx: true, typescript: true });
    case "json": case "jsonc": return json();
    case "md": case "markdown": return markdown();
    case "html": case "htm": case "vue": case "svelte": return html();
    case "xml": case "svg": case "plist": case "xib": case "storyboard": return xml();
    case "css": case "scss": case "less": return css();
    case "py": return python();
    case "yml": case "yaml": return yaml();
    case "go": return go();
    case "rs": return rust();
    case "sql": return sql();
    case "c": case "h": case "cpp": case "cc": case "cxx": case "hpp": case "hh": case "m": case "mm": return cpp();
    case "java": return java();
    case "kt": case "kts": return StreamLanguage.define(kotlin);
    case "php": return php();
    case "sh": case "bash": case "zsh": return StreamLanguage.define(shell);
    case "toml": return StreamLanguage.define(toml);
    case "rb": return StreamLanguage.define(ruby);
    case "swift": return StreamLanguage.define(swift);
    case "lua": return StreamLanguage.define(lua);
    case "diff": case "patch": return StreamLanguage.define(diffMode);
    default: return [];
  }
}

const editorTheme = EditorView.theme({
  "&": { height: "100%", fontSize: "13.5px" },
  ".cm-scroller": {
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
    lineHeight: "1.6",
    overflow: "auto",
  },
  ".cm-content": { padding: "12px 0" },
  ".cm-gutters": { background: "transparent", border: "none", color: "#b0b0b0" },
  ".cm-activeLine": { background: "rgba(0,0,0,0.025)" },
  ".cm-activeLineGutter": { background: "transparent" },
  "&.cm-focused": { outline: "none" },
});

// VSCode 风格的纯文本/代码编辑器(CodeMirror 6)
export function CodeEditor({
  docKey,
  initialValue,
  filename,
  onChange,
  onSave,
}: {
  docKey: string;          // 文件标识,变了就重建编辑器(切文件)
  initialValue: string;
  filename: string;
  onChange: (value: string) => void;
  onSave?: () => void;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const onChangeRef = useRef(onChange);
  const onSaveRef = useRef(onSave);
  onChangeRef.current = onChange;
  onSaveRef.current = onSave;

  // 主题切换时重建编辑器换配色(深色用 oneDark;切主题是罕见动作,重建可接受)
  const [theme, setTheme] = useState(resolvedTheme());
  useEffect(() => {
    const onTheme = () => setTheme(resolvedTheme());
    window.addEventListener(THEME_EVENT, onTheme);
    return () => window.removeEventListener(THEME_EVENT, onTheme);
  }, []);

  // 切换文件(docKey 变)/ 切主题时整体重建,光标/历史归零
  useEffect(() => {
    if (!hostRef.current) return;
    const saveKeymap = keymap.of([
      {
        key: "Mod-s",
        run: () => { onSaveRef.current?.(); return true; },
      },
      indentWithTab,
    ]);
    const state = EditorState.create({
      doc: initialValue,
      extensions: [
        basicSetup,
        saveKeymap,
        langFor(filename),
        editorTheme,
        ...(theme === "dark" ? [oneDark] : []),
        EditorView.updateListener.of((u) => {
          if (u.docChanged) onChangeRef.current(u.state.doc.toString());
        }),
      ],
    });
    const view = new EditorView({ state, parent: hostRef.current });
    return () => { view.destroy(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docKey, theme]);

  return <div ref={hostRef} className="h-full w-full overflow-hidden" />;
}

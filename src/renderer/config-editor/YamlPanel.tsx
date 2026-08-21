import { useEffect, useMemo, useRef } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { yaml } from "@codemirror/lang-yaml";
import { EditorView } from "@codemirror/view";
import { useEditor } from "./context";

export function YamlPanel() {
  const { state, dispatch, previewYamlIntoDraft, syncYamlFromDraft } = useEditor();
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (state.mode === "yaml" && state.draft && !state.parseError) {
      // Keep yaml text in sync when entering panel from form
    }
  }, [state.mode, state.draft, state.parseError]);

  const extensions = useMemo(() => [yaml(), EditorView.lineWrapping], []);

  return (
    <section className="ce-yaml">
      <header className="ce-main-head">
        <div>
          <h2>YAML 源码</h2>
          <p className="muted">{state.path}</p>
        </div>
        <div className="ce-yaml-actions">
          <button
            type="button"
            className="btn btn-sm"
            onClick={() => {
              syncYamlFromDraft();
            }}
            disabled={!state.draft}
          >
            从表单生成
          </button>
          <button
            type="button"
            className="btn btn-sm"
            onClick={() => void previewYamlIntoDraft(state.yamlText)}
          >
            应用到表单
          </button>
        </div>
      </header>
      {state.parseError && <div className="banner banner-fail">{state.parseError}</div>}
      <CodeMirror
        value={state.yamlText}
        height="100%"
        theme="dark"
        extensions={extensions}
        basicSetup={{ lineNumbers: true, foldGutter: true }}
        onChange={(value) => {
          dispatch({ type: "SET_YAML", text: value });
          window.clearTimeout(timer.current);
          timer.current = window.setTimeout(() => {
            void previewYamlIntoDraft(value);
          }, 450);
        }}
      />
    </section>
  );
}

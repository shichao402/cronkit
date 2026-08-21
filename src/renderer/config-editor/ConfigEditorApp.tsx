import { useEffect } from "react";
import { EditorProvider, useEditor } from "./context";
import { TaskList } from "./TaskList";
import { MainPanel } from "./MainPanel";
import { YamlPanel } from "./YamlPanel";
import { draftToYaml } from "../../shared/draft-yaml";

type Host = {
  api: NonNullable<Window["api"]>;
  toast: (message: string, fail?: boolean) => void;
  onSaved: () => Promise<void>;
  onDirtyChange?: (dirty: boolean) => void;
};

export function ConfigEditorApp({
  host,
  focusTaskId,
}: {
  host: Host;
  focusTaskId?: string;
}) {
  return (
    <EditorProvider host={host}>
      <ConfigEditorShell focusTaskId={focusTaskId} />
    </EditorProvider>
  );
}

function ConfigEditorShell({ focusTaskId }: { focusTaskId?: string }) {
  const { state, dispatch, load, save, discard, syncYamlFromDraft } = useEditor();

  useEffect(() => {
    void load(focusTaskId);
  }, [load, focusTaskId]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const mod = event.ctrlKey || event.metaKey;
      if (mod && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void save();
      }
      if (mod && event.key.toLowerCase() === "z" && !event.shiftKey) {
        event.preventDefault();
        dispatch({ type: "UNDO" });
      }
      if (mod && (event.key.toLowerCase() === "y" || (event.shiftKey && event.key.toLowerCase() === "z"))) {
        event.preventDefault();
        dispatch({ type: "REDO" });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dispatch, save]);

  return (
    <div className="ce-root">
      <div className="ce-toolbar">
        <div className="ce-tabs">
          <button
            type="button"
            className={state.mode === "form" ? "is-active" : ""}
            onClick={() => {
              if (state.mode === "yaml" && state.draft) {
                // already may have draft from preview
              }
              if (state.mode === "yaml" && !state.draft) {
                return;
              }
              dispatch({ type: "SET_MODE", mode: "form" });
            }}
            disabled={!state.draft && !!state.parseError}
          >
            表单
          </button>
          <button
            type="button"
            className={state.mode === "yaml" ? "is-active" : ""}
            onClick={() => {
              if (state.mode === "form" && state.draft) {
                syncYamlFromDraft();
              }
              dispatch({ type: "SET_MODE", mode: "yaml" });
            }}
          >
            YAML
          </button>
        </div>
        <div className="ce-toolbar-actions">
          {state.dirty && <span className="ce-dirty">未保存</span>}
          {state.migratedFromV1 && (
            <span className="ce-badge" title={(state.migrationWarnings ?? []).join("\n")}>
              已从 v1 预览迁移
            </span>
          )}
          <button type="button" className="btn btn-sm" onClick={() => dispatch({ type: "UNDO" })}>
            撤销
          </button>
          <button type="button" className="btn btn-sm" onClick={() => dispatch({ type: "REDO" })}>
            重做
          </button>
          <button type="button" className="btn btn-sm" onClick={() => void discard()}>
            从磁盘重新加载
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={state.saving}
            onClick={() => void save(false)}
          >
            {state.saving ? "保存中…" : "保存并生效"}
          </button>
        </div>
      </div>

      {(state.migrationWarnings?.length ?? 0) > 0 && (
        <div className="banner banner-warn">
          {state.migrationWarnings.join("；")}
        </div>
      )}
      {state.issues.length > 0 && (
        <div className="banner banner-fail">
          {state.issues.slice(0, 4).map((issue) => (
            <div key={`${issue.path}:${issue.message}`}>
              <code>{issue.path}</code> {issue.message}
            </div>
          ))}
        </div>
      )}
      {state.conflict && (
        <div className="banner banner-warn ce-conflict">
          <div>磁盘上的配置已被外部修改。</div>
          <div className="ce-conflict-actions">
            <button type="button" className="btn btn-sm" onClick={() => void discard()}>
              重新加载磁盘版本
            </button>
            <button type="button" className="btn btn-sm" onClick={() => void save(true)}>
              覆盖磁盘
            </button>
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => {
                dispatch({ type: "SET_YAML", text: state.conflict!.diskText });
                dispatch({ type: "SET_MODE", mode: "yaml" });
                dispatch({ type: "SET_REVISION", revision: state.conflict!.diskRevision });
                dispatch({ type: "SET_CONFLICT", conflict: undefined });
              }}
            >
              查看磁盘 YAML
            </button>
          </div>
        </div>
      )}

      <div className={`ce-body${state.mode === "yaml" ? " is-yaml" : ""}`}>
        {state.mode === "form" ? (
          <>
            <TaskList />
            <MainPanel />
          </>
        ) : (
          <YamlPanel />
        )}
      </div>
    </div>
  );
}

/** Expose dirty check for vanilla shell navigation. */
export function isEditorDirty(hostRoot: HTMLElement | null): boolean {
  return hostRoot?.dataset.dirty === "1";
}

export function syncDirtyAttr(hostRoot: HTMLElement | null, dirty: boolean): void {
  if (!hostRoot) {
    return;
  }
  hostRoot.dataset.dirty = dirty ? "1" : "0";
}

export { draftToYaml };

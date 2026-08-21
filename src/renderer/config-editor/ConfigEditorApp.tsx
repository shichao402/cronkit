import { useEffect, type ReactNode } from "react";
import { EditorProvider, useEditor } from "./context";
import { TaskList } from "./TaskList";
import { MainPanel } from "./MainPanel";

type Host = {
  api: NonNullable<Window["api"]>;
  toast: (message: string, fail?: boolean) => void;
  onSaved: () => Promise<void>;
  onDirtyChange?: (dirty: boolean) => void;
};

export function ConfigEditorApp({
  host,
  focusTaskId,
  headerExtra,
}: {
  host: Host;
  focusTaskId?: string;
  headerExtra?: ReactNode;
}) {
  return (
    <EditorProvider host={host}>
      <ConfigEditorShell focusTaskId={focusTaskId} headerExtra={headerExtra} />
    </EditorProvider>
  );
}

function ConfigEditorShell({
  focusTaskId,
  headerExtra,
}: {
  focusTaskId?: string;
  headerExtra?: ReactNode;
}) {
  const { state, dispatch, load, save, discard, host } = useEditor();

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
    <>
      <header className="page-head">
        <div className="page-title">
          <h1>配置</h1>
          <p className="page-sub">
            以自动化任务为主：触发器、目标目录与步骤。保存前完整校验，校验失败不写盘。
          </p>
        </div>
        <div className="page-actions">
          {state.dirty && <span className="chip chip-muted">未保存</span>}
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
            disabled={state.saving || !state.draft}
            onClick={() => void save(false)}
          >
            {state.saving ? "保存中…" : "保存并生效"}
          </button>
          {headerExtra}
        </div>
      </header>

      {state.parseError && (
        <div className="banner banner-fail">
          <div>
            <div className="banner-title">配置无法用表单打开</div>
            <div className="banner-body">
              {state.parseError} 请用外部编辑器修好后「从磁盘重新加载」。
            </div>
          </div>
        </div>
      )}
      {state.issues.length > 0 && (
        <div className="banner banner-fail">
          <div>
            <div className="banner-title">校验未通过</div>
            <div className="banner-body">
              {state.issues.slice(0, 4).map((issue) => (
                <div key={`${issue.path}:${issue.message}`}>
                  <code>{issue.path}</code> {issue.message}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
      {state.conflict && (
        <div className="banner banner-warn">
          <div>
            <div className="banner-title">磁盘上的配置已被外部修改</div>
            <div className="banner-body cfg-conflict-actions">
              <button type="button" className="btn btn-sm" onClick={() => void discard()}>
                重新加载磁盘版本
              </button>
              <button type="button" className="btn btn-sm" onClick={() => void save(true)}>
                覆盖磁盘
              </button>
              <button
                type="button"
                className="btn btn-sm"
                onClick={() =>
                  void host.api.openConfig().then((result) => {
                    if (!result.ok) {
                      host.toast(result.error ?? "无法打开配置文件", true);
                      return;
                    }
                    host.toast("已用外部编辑器打开配置文件");
                  })
                }
              >
                外部编辑器查看
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="cfg-body">
        <TaskList />
        <MainPanel />
      </div>
    </>
  );
}

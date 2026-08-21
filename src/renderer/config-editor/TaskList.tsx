import { useEditor } from "./context";
import { createTask } from "./state";
import { describeCron } from "./cron";

export function TaskList() {
  const { state, dispatch } = useEditor();
  const draft = state.draft;

  if (!draft) {
    return (
      <aside className="block cfg-rail">
        <div className="empty">
          <div className="empty-title">配置无法用表单打开</div>
          <div className="empty-hint">请先在 YAML 面板修好语法，或从磁盘重新加载。</div>
        </div>
      </aside>
    );
  }

  const addTask = () => {
    const task = createTask(draft.tasks);
    dispatch({
      type: "PATCH_DRAFT",
      draft: { ...draft, tasks: [...draft.tasks, task] },
    });
    dispatch({ type: "SELECT", selection: { kind: "task", taskId: task.id } });
  };

  return (
    <aside className="block cfg-rail">
      <div className="block-head">
        <h2>自动化任务</h2>
        <button type="button" className="btn btn-sm" onClick={addTask}>
          新建
        </button>
      </div>

      {draft.tasks.length === 0 ? (
        <div className="empty">
          <div className="empty-title">还没有任务</div>
          <div className="empty-hint">
            创建一个自动化任务：设定触发时间，并挂上要跑的工作目录步骤。
          </div>
          <button type="button" className="btn btn-sm btn-primary" onClick={addTask}>
            添加第一个任务
          </button>
        </div>
      ) : (
        <div className="rows">
          {draft.tasks.map((task) => {
            const active =
              state.selection.kind !== "none" &&
              state.selection.kind !== "runtime" &&
              "taskId" in state.selection &&
              state.selection.taskId === task.id;
            const triggerLabel =
              task.trigger.type === "cron" ? describeCron(task.trigger.cron) : "仅手动";
            return (
              <article
                key={task.id}
                className={`row-card cfg-task${active ? " is-selected" : ""}${
                  task.enabled ? "" : " is-off"
                }`}
              >
                <button
                  type="button"
                  className="cfg-task-hit"
                  onClick={() =>
                    dispatch({ type: "SELECT", selection: { kind: "task", taskId: task.id } })
                  }
                >
                  <div className="ws-line">
                    <h3>{task.name || task.id}</h3>
                    {!task.enabled && <span className="chip chip-muted">已停用</span>}
                    <span className="chip chip-mono">{task.targets.length} 个目标</span>
                  </div>
                  <p className="ws-path">{triggerLabel}</p>
                </button>
              </article>
            );
          })}
        </div>
      )}

      <button
        type="button"
        className={`cfg-runtime-link${state.selection.kind === "runtime" ? " is-selected" : ""}`}
        onClick={() => dispatch({ type: "SELECT", selection: { kind: "runtime" } })}
      >
        运行时与时区
      </button>
    </aside>
  );
}

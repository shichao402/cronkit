import { useEditor } from "./context";
import { createTask } from "./state";
import { describeCron } from "./cron";

export function TaskList() {
  const { state, dispatch } = useEditor();
  const draft = state.draft;

  if (!draft) {
    return (
      <aside className="ce-rail">
        <div className="ce-empty">
          <h3>配置无法用表单打开</h3>
          <p>请先在 YAML 面板修好语法，或从磁盘重新加载。</p>
        </div>
      </aside>
    );
  }

  return (
    <aside className="ce-rail">
      <div className="ce-rail-head">
        <strong>自动化任务</strong>
        <button
          type="button"
          className="btn btn-sm"
          onClick={() => {
            const task = createTask(draft.tasks);
            dispatch({
              type: "PATCH_DRAFT",
              draft: { ...draft, tasks: [...draft.tasks, task] },
            });
            dispatch({ type: "SELECT", selection: { kind: "task", taskId: task.id } });
          }}
        >
          新建
        </button>
      </div>
      {draft.tasks.length === 0 ? (
        <div className="ce-empty">
          <h3>还没有任务</h3>
          <p>创建一个自动化任务：设定触发时间，并挂上要跑的工作目录步骤。</p>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => {
              const task = createTask([]);
              dispatch({ type: "PATCH_DRAFT", draft: { ...draft, tasks: [task] } });
              dispatch({ type: "SELECT", selection: { kind: "task", taskId: task.id } });
            }}
          >
            添加第一个任务
          </button>
        </div>
      ) : (
        <ul className="ce-task-list">
          {draft.tasks.map((task) => {
            const active =
              state.selection.kind !== "none" &&
              state.selection.kind !== "runtime" &&
              "taskId" in state.selection &&
              state.selection.taskId === task.id;
            const triggerLabel =
              task.trigger.type === "cron"
                ? describeCron(task.trigger.cron)
                : "仅手动";
            return (
              <li key={task.id}>
                <button
                  type="button"
                  className={`ce-task-item${active ? " is-active" : ""}${task.enabled ? "" : " is-off"}`}
                  onClick={() =>
                    dispatch({ type: "SELECT", selection: { kind: "task", taskId: task.id } })
                  }
                >
                  <span className="ce-task-title">{task.name || task.id}</span>
                  <span className="ce-task-meta">
                    {triggerLabel} · {task.targets.length} 个目标
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <button
        type="button"
        className={`ce-runtime-link${state.selection.kind === "runtime" ? " is-active" : ""}`}
        onClick={() => dispatch({ type: "SELECT", selection: { kind: "runtime" } })}
      >
        运行时与时区
      </button>
    </aside>
  );
}

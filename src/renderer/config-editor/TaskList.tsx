import { useEditor } from "./context";
import { createTask, createTemplate } from "./state";
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

  const templates = draft.stepTemplates ?? [];
  const tab = state.railTab;

  const addTask = () => {
    const task = createTask(draft.tasks);
    dispatch({
      type: "PATCH_DRAFT",
      draft: { ...draft, tasks: [...draft.tasks, task] },
    });
    dispatch({ type: "SELECT", selection: { kind: "task", taskId: task.id } });
  };

  const addTemplate = () => {
    const template = createTemplate(templates);
    dispatch({
      type: "PATCH_DRAFT",
      draft: { ...draft, stepTemplates: [...templates, template] },
    });
    dispatch({ type: "SELECT", selection: { kind: "template", templateId: template.id } });
  };

  const usageCount = (templateId: string): number =>
    draft.tasks.reduce(
      (sum, task) =>
        sum + task.targets.filter((target) => target.usesTemplate === templateId).length,
      0,
    );

  return (
    <aside className="block cfg-rail">
      <div className="seg seg-rail" role="tablist" aria-label="配置分区">
        <button
          type="button"
          role="tab"
          aria-pressed={tab === "tasks"}
          aria-selected={tab === "tasks"}
          onClick={() => dispatch({ type: "SET_RAIL_TAB", tab: "tasks" })}
        >
          任务配置
        </button>

        <button
          type="button"
          role="tab"
          aria-pressed={tab === "templates"}
          aria-selected={tab === "templates"}
          onClick={() => dispatch({ type: "SET_RAIL_TAB", tab: "templates" })}
        >
          步骤模板
          {templates.length > 0 && <span className="seg-count">{templates.length}</span>}
        </button>
      </div>

      {tab === "tasks" ? (
        <>
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
        </>
      ) : (
        <>
          <div className="block-head">
            <h2>步骤模板</h2>
            <button type="button" className="btn btn-sm" onClick={addTemplate}>
              新建
            </button>
          </div>
          <p className="form-note">一处编辑，所有引用它的目录同步生效。</p>

          {templates.length === 0 ? (
            <div className="empty">
              <div className="empty-title">还没有模板</div>
              <div className="empty-hint">
                多个目录步骤相同时，抽成模板即可只改一遍。可在「任务配置」的目标目录里点「抽成模板」。
              </div>
              <button type="button" className="btn btn-sm btn-primary" onClick={addTemplate}>
                新建空模板
              </button>
            </div>
          ) : (
            <div className="rows">
              {templates.map((template) => {
                const active =
                  (state.selection.kind === "template" ||
                    state.selection.kind === "templateStep") &&
                  state.selection.templateId === template.id;
                const used = usageCount(template.id);
                return (
                  <article
                    key={template.id}
                    className={`row-card cfg-task${active ? " is-selected" : ""}`}
                  >
                    <button
                      type="button"
                      className="cfg-task-hit"
                      onClick={() =>
                        dispatch({
                          type: "SELECT",
                          selection: { kind: "template", templateId: template.id },
                        })
                      }
                    >
                      <div className="ws-line">
                        <h3>{template.name || template.id}</h3>
                        <span className="chip chip-mono">{template.steps.length} 步</span>
                        <span className={`chip ${used > 0 ? "chip-mono" : "chip-muted"}`}>
                          {used > 0 ? `${used} 处引用` : "未使用"}
                        </span>
                      </div>
                      {template.vars.length > 0 && (
                        <p className="ws-path">
                          变量：{template.vars.map((item) => item.name).join("、")}
                        </p>
                      )}
                    </button>
                  </article>
                );
              })}
            </div>
          )}
        </>
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

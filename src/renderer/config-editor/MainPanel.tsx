import { useState } from "react";
import type { EditorStep, EditorTrigger, ToolParamView, ToolsetView } from "../../shared/types";
import { Icon } from "../components/Icon";
import { useEditor } from "./context";
import {
  createTarget,
  defaultStepParams,
  findTask,
  moveStep,
  setTrigger,
  updateStep,
  updateTarget,
  updateTask,
} from "./state";
import {
  buildCron,
  describeCron,
  minuteIntervals,
  parseSchedule,
  parseTimeValue,
  scheduleForKind,
  scheduleKindLabels,
  scheduleOutlook,
  timeValue,
  weekdayLabel,
  withTime,
  type Schedule,
  type ScheduleKind,
} from "./cron";

function issueFor(path: string, issues: { path: string; message: string }[]): string | undefined {
  return issues.find((item) => item.path === path || item.path.startsWith(`${path}.`))?.message;
}

export function MainPanel() {
  const { state, dispatch, host } = useEditor();
  const { draft, selection, issues, toolsets } = state;
  if (!draft) {
    return (
      <section className="cfg-main">
        <div className="empty">
          <div className="empty-title">配置无法用表单打开</div>
          <div className="empty-hint">切换到 YAML 修复配置后即可使用表单。</div>
        </div>
      </section>
    );
  }

  if (selection.kind === "runtime") {
    return (
      <section className="cfg-main">
        <header className="block-head">
          <h2>运行时</h2>
        </header>
        <div className="form-grid">
          <label>
            时区
            <input
              value={draft.timezone}
              onChange={(e) =>
                dispatch({
                  type: "PATCH_DRAFT",
                  draft: { ...draft, timezone: e.target.value },
                })
              }
            />
          </label>
          <label>
            最大并发
            <input
              type="number"
              min={1}
              value={draft.runtime.maxConcurrentRuns}
              onChange={(e) =>
                dispatch({
                  type: "PATCH_DRAFT",
                  draft: {
                    ...draft,
                    runtime: {
                      ...draft.runtime,
                      maxConcurrentRuns: Number(e.target.value) || 1,
                    },
                  },
                })
              }
            />
          </label>
          <label>
            补跑天数
            <input
              type="number"
              min={0}
              value={draft.runtime.catchUpPreviousDays}
              onChange={(e) =>
                dispatch({
                  type: "PATCH_DRAFT",
                  draft: {
                    ...draft,
                    runtime: {
                      ...draft.runtime,
                      catchUpPreviousDays: Number(e.target.value) || 0,
                    },
                  },
                })
              }
            />
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={draft.runtime.retryFailedOnCatchUp}
              onChange={(e) =>
                dispatch({
                  type: "PATCH_DRAFT",
                  draft: {
                    ...draft,
                    runtime: {
                      ...draft.runtime,
                      retryFailedOnCatchUp: e.target.checked,
                    },
                  },
                })
              }
            />
            补跑时重试失败任务
          </label>
          <details className="cfg-advanced">
            <summary>高级</summary>
            <label className="check">
              <input
                type="checkbox"
                checked={draft.runtime.releaseOccupants !== false}
                onChange={(e) =>
                  dispatch({
                    type: "PATCH_DRAFT",
                    draft: {
                      ...draft,
                      runtime: {
                        ...draft.runtime,
                        releaseOccupants: e.target.checked,
                      },
                    },
                  })
                }
              />
              运行前释放目录占用
            </label>
            <label>
              释放宽限 (ms)
              <input
                type="number"
                min={0}
                value={draft.runtime.releaseGraceMs ?? 20_000}
                onChange={(e) =>
                  dispatch({
                    type: "PATCH_DRAFT",
                    draft: {
                      ...draft,
                      runtime: {
                        ...draft.runtime,
                        releaseGraceMs: Number(e.target.value) || 0,
                      },
                    },
                  })
                }
              />
            </label>
          </details>
        </div>
      </section>
    );
  }

  if (selection.kind === "none") {
    return (
      <section className="cfg-main">
        <div className="empty">
          <div className="empty-title">未选择任务</div>
          <div className="empty-hint">从左侧选择一个自动化任务。</div>
        </div>
      </section>
    );
  }

  const task = findTask(draft, selection.taskId);
  if (!task) {
    return (
      <section className="cfg-main">
        <div className="empty">
          <div className="empty-title">任务不存在</div>
          <div className="empty-hint">请重新选择左侧列表中的任务。</div>
        </div>
      </section>
    );
  }

  const selectedTargetId =
    selection.kind === "target" || selection.kind === "step"
      ? selection.targetId
      : task.targets[0]?.id;
  const target = task.targets.find((item) => item.id === selectedTargetId);
  const selectedStepIndex = selection.kind === "step" ? selection.stepIndex : -1;

  return (
    <section className="cfg-main">
      <header className="block-head">
        <div>
          <h2>{task.name || task.id}</h2>
          <p className="form-note">id: {task.id}</p>
        </div>
        <label className="check">
          <input
            type="checkbox"
            checked={task.enabled}
            onChange={(e) =>
              dispatch({
                type: "PATCH_DRAFT",
                draft: updateTask(draft, task.id, (t) => ({ ...t, enabled: e.target.checked })),
              })
            }
          />
          启用调度
        </label>
      </header>

      <div className="form-grid">
        <label>
          名称
          <input
            value={task.name}
            onChange={(e) =>
              dispatch({
                type: "PATCH_DRAFT",
                draft: updateTask(draft, task.id, (t) => ({ ...t, name: e.target.value })),
                pushHistory: false,
              })
            }
            onBlur={(e) =>
              dispatch({
                type: "PATCH_DRAFT",
                draft: updateTask(draft, task.id, (t) => ({ ...t, name: e.target.value })),
              })
            }
          />
          {issueFor(`tasks.${task.id}.name`, issues) && (
            <span className="field-error">{issueFor(`tasks.${task.id}.name`, issues)}</span>
          )}
        </label>
        <label>
          ID
          <input
            value={task.id}
            onChange={(e) => {
              const nextId = e.target.value;
              dispatch({
                type: "PATCH_DRAFT",
                draft: {
                  ...draft,
                  tasks: draft.tasks.map((t) => (t.id === task.id ? { ...t, id: nextId } : t)),
                },
                pushHistory: false,
              });
              dispatch({ type: "SELECT", selection: { kind: "task", taskId: nextId } });
            }}
          />
        </label>
      </div>

      <TriggerEditor
        key={task.id}
        trigger={task.trigger}
        timezone={draft.timezone}
        onChange={(trigger) =>
          dispatch({
            type: "PATCH_DRAFT",
            draft: updateTask(draft, task.id, (t) => setTrigger(t, trigger)),
          })
        }
      />

      <div className="block cfg-section">
        <div className="block-head">
          <h3>目标目录</h3>
          <button
            type="button"
            className="btn btn-sm"
            onClick={() => {
              const taken = new Set(draft.tasks.flatMap((t) => t.targets.map((x) => x.id)));
              const next = createTarget(taken);
              dispatch({
                type: "PATCH_DRAFT",
                draft: updateTask(draft, task.id, (t) => ({
                  ...t,
                  targets: [...t.targets, next],
                })),
              });
              dispatch({
                type: "SELECT",
                selection: { kind: "target", taskId: task.id, targetId: next.id },
              });
            }}
          >
            添加目录
          </button>
        </div>
        <p className="form-note">每个目标独立入队，不是跨目录串行流水线。</p>
        <div className="cfg-target-tabs">
          {task.targets.map((item) => (
            <button
              key={item.id}
              type="button"
              className={item.id === selectedTargetId ? "is-active" : ""}
              onClick={() =>
                dispatch({
                  type: "SELECT",
                  selection: { kind: "target", taskId: task.id, targetId: item.id },
                })
              }
            >
              {item.name || item.id}
            </button>
          ))}
        </div>
        {target && (
          <TargetEditor
            taskId={task.id}
            target={target}
            selectedStepIndex={selectedStepIndex}
            toolsets={toolsets}
            issues={issues}
            onPickFolder={async () => {
              const folder = await host.api.pickFolder();
              if (!folder) {
                return;
              }
              dispatch({
                type: "PATCH_DRAFT",
                draft: updateTarget(draft, task.id, target.id, (t) => ({
                  ...t,
                  path: folder.replace(/\\/g, "/"),
                })),
              });
            }}
            onSelectStep={(index) =>
              dispatch({
                type: "SELECT",
                selection: {
                  kind: "step",
                  taskId: task.id,
                  targetId: target.id,
                  stepIndex: index,
                },
              })
            }
            onChangeTarget={(updater) =>
              dispatch({
                type: "PATCH_DRAFT",
                draft: updateTarget(draft, task.id, target.id, updater),
              })
            }
            onChangeStep={(index, updater) =>
              dispatch({
                type: "PATCH_DRAFT",
                draft: updateStep(draft, task.id, target.id, index, updater),
              })
            }
            onMoveStep={(from, to) =>
              dispatch({
                type: "PATCH_DRAFT",
                draft: moveStep(draft, task.id, target.id, from, to),
              })
            }
            onDeleteTarget={() => {
              if (task.targets.length <= 1) {
                host.toast("任务至少保留一个目标", true);
                return;
              }
              if (!window.confirm(`删除目标「${target.name}」？`)) {
                return;
              }
              dispatch({
                type: "PATCH_DRAFT",
                draft: updateTask(draft, task.id, (t) => ({
                  ...t,
                  targets: t.targets.filter((x) => x.id !== target.id),
                })),
              });
              dispatch({ type: "SELECT", selection: { kind: "task", taskId: task.id } });
            }}
            onDeleteTask={() => {
              if (draft.tasks.length <= 1) {
                host.toast("至少保留一个任务", true);
                return;
              }
              if (!window.confirm(`删除任务「${task.name}」及其目标？`)) {
                return;
              }
              dispatch({
                type: "PATCH_DRAFT",
                draft: { ...draft, tasks: draft.tasks.filter((t) => t.id !== task.id) },
              });
              dispatch({ type: "SELECT", selection: { kind: "none" } });
            }}
          />
        )}
      </div>
    </section>
  );
}

const SCHEDULE_KINDS: ScheduleKind[] = ["daily", "weekly", "hourly", "minutes", "custom"];
const HOURS = Array.from({ length: 24 }, (_, i) => i);
const MINUTE_MARKS = Array.from({ length: 12 }, (_, i) => i * 5);
const WEEKDAY_ORDER = [1, 2, 3, 4, 5, 6, 0];

/** 手写 YAML 可能给出选项以外的值（如每 7 分钟），补进列表以免 select 显示空白。 */
function optionsWith(options: readonly number[], value: number): number[] {
  return options.includes(value) ? [...options] : [...options, value].sort((a, b) => a - b);
}

function TriggerEditor({
  trigger,
  timezone,
  onChange,
}: {
  trigger: EditorTrigger;
  timezone: string;
  onChange: (trigger: EditorTrigger) => void;
}) {
  const cron = trigger.type === "cron" ? trigger.cron : "10 2 * * *";
  const parsed = parseSchedule(cron);
  // 表达式能被表单表示时也允许用户停在自定义模式，避免输入过程被抢走。
  const [preferCustom, setPreferCustom] = useState(!parsed);
  const kind: ScheduleKind = parsed && !preferCustom ? parsed.kind : "custom";
  const outlook = trigger.type === "cron" ? scheduleOutlook(cron, timezone) : null;
  const apply = (schedule: Schedule) => onChange({ type: "cron", cron: buildCron(schedule) });

  return (
    <div className="block cfg-section">
      <h3>运行时间</h3>
      <div className="seg" role="group" aria-label="触发方式">
        <button
          type="button"
          aria-pressed={trigger.type === "cron"}
          onClick={() => onChange({ type: "cron", cron })}
        >
          按计划
        </button>
        <button
          type="button"
          aria-pressed={trigger.type === "manual"}
          onClick={() => onChange({ type: "manual" })}
        >
          仅手动
        </button>
      </div>

      {trigger.type === "manual" ? (
        <p className="form-note">不自动调度，只在你手动运行时执行。</p>
      ) : (
        <>
          <div className="cfg-sched">
            <label className="cfg-field">
              重复
              <select
                value={kind}
                onChange={(e) => {
                  const next = e.target.value as ScheduleKind;
                  if (next === "custom") {
                    setPreferCustom(true);
                    return;
                  }
                  setPreferCustom(false);
                  apply(scheduleForKind(next, parsed));
                }}
              >
                {SCHEDULE_KINDS.map((item) => (
                  <option key={item} value={item}>
                    {scheduleKindLabels[item]}
                  </option>
                ))}
              </select>
            </label>

            {(kind === "daily" || kind === "weekly") && parsed && "hour" in parsed && (
              <label className="cfg-field">
                时间
                <input
                  type="time"
                  value={timeValue(parsed.hour, parsed.minute)}
                  onChange={(e) => {
                    const time = parseTimeValue(e.target.value);
                    if (time) {
                      apply(withTime(parsed, time.hour, time.minute));
                    }
                  }}
                />
              </label>
            )}

            {kind === "hourly" && parsed?.kind === "hourly" && (
              <label className="cfg-field">
                每小时第
                <select
                  value={parsed.minute}
                  onChange={(e) => apply({ ...parsed, minute: Number(e.target.value) })}
                >
                  {optionsWith(MINUTE_MARKS, parsed.minute).map((minute) => (
                    <option key={minute} value={minute}>
                      {minute} 分
                    </option>
                  ))}
                </select>
              </label>
            )}

            {kind === "minutes" && parsed?.kind === "minutes" && (
              <>
                <label className="cfg-field">
                  间隔
                  <select
                    value={parsed.every}
                    onChange={(e) => apply({ ...parsed, every: Number(e.target.value) })}
                  >
                    {optionsWith(minuteIntervals, parsed.every).map((every) => (
                      <option key={every} value={every}>
                        每 {every} 分钟
                      </option>
                    ))}
                  </select>
                </label>
                <label className="cfg-field">
                  时段
                  <span className="cfg-hour-range">
                    <select
                      value={parsed.fromHour}
                      onChange={(e) => {
                        const fromHour = Number(e.target.value);
                        apply({
                          ...parsed,
                          fromHour,
                          toHour: Math.max(fromHour, parsed.toHour),
                        });
                      }}
                    >
                      {HOURS.map((hour) => (
                        <option key={hour} value={hour}>
                          {hour} 点
                        </option>
                      ))}
                    </select>
                    <span className="form-note">至</span>
                    <select
                      value={parsed.toHour}
                      onChange={(e) => apply({ ...parsed, toHour: Number(e.target.value) })}
                    >
                      {HOURS.filter((hour) => hour >= parsed.fromHour).map((hour) => (
                        <option key={hour} value={hour}>
                          {hour} 点
                        </option>
                      ))}
                    </select>
                  </span>
                </label>
              </>
            )}

            {kind === "custom" && (
              <label className="cfg-field cfg-field-wide">
                cron 表达式
                <input
                  className="cfg-cron-input"
                  value={cron}
                  spellCheck={false}
                  placeholder="分 时 日 月 周"
                  onChange={(e) => onChange({ type: "cron", cron: e.target.value })}
                />
              </label>
            )}
          </div>

          {kind === "weekly" && parsed?.kind === "weekly" && (
            <div className="cfg-weekdays">
              {WEEKDAY_ORDER.map((day) => {
                const on = parsed.weekdays.includes(day);
                return (
                  <button
                    key={day}
                    type="button"
                    className={on ? "is-active" : ""}
                    aria-pressed={on}
                    onClick={() => {
                      const weekdays = on
                        ? parsed.weekdays.filter((item) => item !== day)
                        : [...parsed.weekdays, day];
                      if (weekdays.length) {
                        apply({ ...parsed, weekdays });
                      }
                    }}
                  >
                    {weekdayLabel(day)}
                  </button>
                );
              })}
            </div>
          )}

          <p className="cfg-sched-outlook">
            {outlook ? (
              <>
                <span>{describeCron(cron)}</span>
                <span className="form-note">
                  下次 {outlook.next}
                  {outlook.later.length > 0 && ` · 之后 ${outlook.later.join("、")}`} · {timezone}
                </span>
              </>
            ) : (
              <span className="field-error">{describeCron(cron)} · 无法推算运行时间</span>
            )}
          </p>
        </>
      )}
    </div>
  );
}

function TargetEditor(props: {
  taskId: string;
  target: ReturnType<typeof createTarget>;
  selectedStepIndex: number;
  toolsets: ToolsetView[];
  issues: { path: string; message: string }[];
  onPickFolder: () => void;
  onSelectStep: (index: number) => void;
  onChangeTarget: (updater: (t: typeof props.target) => typeof props.target) => void;
  onChangeStep: (index: number, updater: (s: EditorStep) => EditorStep) => void;
  onMoveStep: (from: number, to: number) => void;
  onDeleteTarget: () => void;
  onDeleteTask: () => void;
}) {
  const {
    taskId,
    target,
    selectedStepIndex,
    toolsets,
    issues,
    onPickFolder,
    onSelectStep,
    onChangeTarget,
    onChangeStep,
    onMoveStep,
    onDeleteTarget,
    onDeleteTask,
  } = props;
  const pathError = issueFor(`tasks.${taskId}.targets.${target.id}.path`, issues);

  return (
    <div className="cfg-target">
      <div className="form-grid">
        <label>
          显示名
          <input
            value={target.name}
            onChange={(e) => onChangeTarget((t) => ({ ...t, name: e.target.value }))}
          />
        </label>
        <label>
          ID
          <input
            value={target.id}
            onChange={(e) => onChangeTarget((t) => ({ ...t, id: e.target.value }))}
          />
        </label>
        <label className="span-2">
          路径
          <div className="cfg-path-row">
            <input
              value={target.path}
              onChange={(e) => onChangeTarget((t) => ({ ...t, path: e.target.value }))}
            />
            <button type="button" className="btn btn-quiet btn-sm" onClick={onPickFolder}>
              浏览…
            </button>
          </div>
          {pathError && <span className="field-error">{pathError}</span>}
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={target.oncePerDay}
            onChange={(e) => onChangeTarget((t) => ({ ...t, oncePerDay: e.target.checked }))}
          />
          每天只跑一次（按本地日期去重）
        </label>
      </div>

      <div className="block-head">
        <h4>步骤</h4>
        <button
          type="button"
          className="btn btn-sm"
          onClick={() => {
            const step: EditorStep = {
              toolsetId: "builtin",
              tool: "svn-update",
              timeout: "30m",
              params: defaultStepParams(toolsets, "builtin", "svn-update"),
            };
            onChangeTarget((t) => ({ ...t, steps: [...t.steps, step] }));
            onSelectStep(target.steps.length);
          }}
        >
          添加步骤
        </button>
      </div>

      <div className="rows cfg-steps">
        {target.steps.map((step, index) => (
          <article
            key={`${step.toolsetId}/${step.tool}/${index}`}
            className={`row-card cfg-step${index === selectedStepIndex ? " is-selected" : ""}`}
          >
            <div className="cfg-step-head">
              <button type="button" className="cfg-step-hit" onClick={() => onSelectStep(index)}>
                <div className="ws-line">
                  <h3>
                    {index + 1}. {step.tool}
                  </h3>
                  <span className="chip chip-mono">
                    {step.toolsetId}/{step.tool}
                  </span>
                  <span className="chip chip-muted">{step.timeout}</span>
                </div>
              </button>
              <div className="cfg-step-actions">
                <button
                  type="button"
                  className="btn btn-icon btn-sm btn-quiet"
                  disabled={index === 0}
                  title="上移"
                  aria-label="上移"
                  onClick={() => onMoveStep(index, index - 1)}
                >
                  <Icon name="up" />
                </button>
                <button
                  type="button"
                  className="btn btn-icon btn-sm btn-quiet"
                  disabled={index === target.steps.length - 1}
                  title="下移"
                  aria-label="下移"
                  onClick={() => onMoveStep(index, index + 1)}
                >
                  <Icon name="down" />
                </button>
                <button
                  type="button"
                  className="btn btn-icon btn-sm btn-quiet"
                  title="删除步骤"
                  aria-label="删除步骤"
                  onClick={() => {
                    if (target.steps.length <= 1) {
                      return;
                    }
                    onChangeTarget((t) => ({
                      ...t,
                      steps: t.steps.filter((_, i) => i !== index),
                    }));
                  }}
                >
                  <Icon name="trash" />
                </button>
              </div>
            </div>
            {index === selectedStepIndex && (
              <StepForm
                step={step}
                toolsets={toolsets}
                onChange={(updater) => onChangeStep(index, updater)}
              />
            )}
          </article>
        ))}
      </div>

      <div className="cfg-danger">
        <button type="button" className="btn btn-danger" onClick={onDeleteTarget}>
          删除此目标
        </button>
        <button type="button" className="btn btn-danger" onClick={onDeleteTask}>
          删除整个任务
        </button>
      </div>
    </div>
  );
}

function StepForm({
  step,
  toolsets,
  onChange,
}: {
  step: EditorStep;
  toolsets: ToolsetView[];
  onChange: (updater: (s: EditorStep) => EditorStep) => void;
}) {
  const tools = toolsets.flatMap((ts) =>
    ts.tools.map((tool) => ({
      value: `${ts.id}::${tool.id}`,
      label: `${ts.displayName} / ${tool.displayName}`,
      toolsetId: ts.id,
      toolId: tool.id,
      params: tool.params ?? [],
      remoteWrite: false,
    })),
  );
  const current = tools.find((t) => t.toolsetId === step.toolsetId && t.toolId === step.tool);
  const params = current?.params ?? [];
  const required = params.filter((p) => p.required);
  const optional = params.filter((p) => !p.required);

  return (
    <div className="cfg-step-form">
      <label>
        工具
        <select
          value={`${step.toolsetId}::${step.tool}`}
          onChange={(e) => {
            const [toolsetId, tool] = e.target.value.split("::");
            onChange(() => ({
              toolsetId,
              tool,
              timeout: step.timeout || "30m",
              params: defaultStepParams(toolsets, toolsetId, tool),
            }));
          }}
        >
          {toolsets.map((ts) => (
            <optgroup key={ts.id} label={ts.displayName}>
              {ts.tools.map((tool) => (
                <option key={`${ts.id}::${tool.id}`} value={`${ts.id}::${tool.id}`}>
                  {tool.displayName}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </label>
      <div className="param-grid">
        {required.map((param) => (
          <ParamField
            key={param.name}
            param={param}
            value={step.params[param.name]}
            onChange={(value) =>
              onChange((s) => ({ ...s, params: { ...s.params, [param.name]: value } }))
            }
          />
        ))}
      </div>
      <details className="cfg-advanced">
        <summary>高级选项</summary>
        <div className="param-grid">
          {optional.map((param) => (
            <ParamField
              key={param.name}
              param={param}
              value={step.params[param.name]}
              onChange={(value) =>
                onChange((s) => ({ ...s, params: { ...s.params, [param.name]: value } }))
              }
            />
          ))}
          <label>
            超时
            <input
              value={step.timeout}
              onChange={(e) => onChange((s) => ({ ...s, timeout: e.target.value }))}
            />
          </label>
          <label>
            重试次数
            <input
              type="number"
              min={0}
              value={step.retry ?? 0}
              onChange={(e) =>
                onChange((s) => ({ ...s, retry: Number(e.target.value) || 0 }))
              }
            />
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={!!step.continueOnError}
              onChange={(e) => onChange((s) => ({ ...s, continueOnError: e.target.checked }))}
            />
            失败后继续
          </label>
          <label>
            相对路径 path
            <input
              value={step.path ?? ""}
              onChange={(e) =>
                onChange((s) => ({ ...s, path: e.target.value || undefined }))
              }
              placeholder="例如 Project"
            />
          </label>
        </div>
      </details>
    </div>
  );
}

function ParamField({
  param,
  value,
  onChange,
}: {
  param: ToolParamView;
  value: unknown;
  onChange: (value: unknown) => void;
}) {
  if (param.type === "boolean") {
    return (
      <label className="check">
        <input
          type="checkbox"
          checked={value === true}
          onChange={(e) => onChange(e.target.checked)}
        />
        {param.name}
      </label>
    );
  }
  if (param.type === "enum") {
    return (
      <label>
        {param.name}
        <select value={String(value ?? "")} onChange={(e) => onChange(e.target.value)}>
          {(param.enum ?? []).map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </select>
      </label>
    );
  }
  if (param.type === "string[]") {
    return (
      <label>
        {param.name}
        <input
          value={Array.isArray(value) ? value.join(", ") : ""}
          onChange={(e) =>
            onChange(
              e.target.value
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean),
            )
          }
          placeholder="逗号分隔"
        />
      </label>
    );
  }
  if (param.type === "number") {
    return (
      <label>
        {param.name}
        <input
          type="number"
          value={typeof value === "number" ? value : Number(value) || 0}
          onChange={(e) => onChange(Number(e.target.value))}
        />
      </label>
    );
  }
  return (
    <label>
      {param.name}
      <input
        value={value == null ? "" : String(value)}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}

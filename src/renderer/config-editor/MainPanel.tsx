import { useEffect, useMemo, useRef, useState } from "react";
import type {
  EditorStep,
  EditorTrigger,
  StepTemplate,
  ToolParamView,
  ToolsetView,
} from "../../shared/types";
import { Icon } from "../components/Icon";
import { useEditor } from "./context";
import {
  applyTemplateToTarget,
  createTarget,
  defaultStepParams,
  deleteTemplate,
  detachTemplateFromTarget,
  duplicateTarget,
  extractTemplateFromTarget,
  findTask,
  findTemplate,
  moveStep,
  moveTemplateStep,
  setTrigger,
  undeclaredVarNames,
  updateStep,
  updateTarget,
  updateTask,
  updateTemplate,
  updateTemplateStep,
} from "./state";
import { collectVarNames, expandTemplate } from "../../shared/step-template";

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
              运行前释放目录占用（Unity / wc.db 等）。SVN 更新还可按本次写集单独处理文件独占。
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

  if (selection.kind === "template" || selection.kind === "templateStep") {
    const template = findTemplate(draft, selection.templateId);
    if (!template) {
      return (
        <section className="cfg-main">
          <div className="empty">
            <div className="empty-title">模板不存在</div>
            <div className="empty-hint">请重新从左侧选择一个步骤模板。</div>
          </div>
        </section>
      );
    }
    const usedBy = draft.tasks.flatMap((task) =>
      task.targets
        .filter((target) => target.usesTemplate === template.id)
        .map((target) => ({ taskName: task.name || task.id, targetName: target.name || target.id })),
    );
    return (
      <TemplateEditor
        template={template}
        usedBy={usedBy}
        toolsets={toolsets}
        issues={issues}
        selectedStepIndex={selection.kind === "templateStep" ? selection.stepIndex : -1}
        onSelectStep={(index) =>
          dispatch({
            type: "SELECT",
            selection: { kind: "templateStep", templateId: template.id, stepIndex: index },
          })
        }
        onChange={(updater) =>
          dispatch({
            type: "PATCH_DRAFT",
            draft: updateTemplate(draft, template.id, updater),
          })
        }
        onChangeStep={(index, updater) =>
          dispatch({
            type: "PATCH_DRAFT",
            draft: updateTemplateStep(draft, template.id, index, updater),
          })
        }
        onMoveStep={(from, to) =>
          dispatch({
            type: "PATCH_DRAFT",
            draft: moveTemplateStep(draft, template.id, from, to),
          })
        }
        onDelete={() => {
          const note =
            usedBy.length > 0
              ? `删除模板「${template.name}」？${usedBy.length} 个目录会改为保留各自的展开步骤。`
              : `删除模板「${template.name}」？`;
          if (!window.confirm(note)) {
            return;
          }
          dispatch({ type: "PATCH_DRAFT", draft: deleteTemplate(draft, template.id) });
          dispatch({ type: "SELECT", selection: { kind: "none" } });
          host.toast("模板已删除，原引用目录已保留展开后的步骤");
        }}
      />
    );
  }

  if (selection.kind === "none") {
    const onTemplates = state.railTab === "templates";
    return (
      <section className="cfg-main">
        <div className="empty">
          <div className="empty-title">{onTemplates ? "未选择模板" : "未选择任务"}</div>
          <div className="empty-hint">
            {onTemplates
              ? "从左侧选择一个步骤模板，或新建一个。"
              : "从左侧选择一个自动化任务。"}
          </div>
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
          <input value={task.id} readOnly disabled className="input-readonly" />
          <span className="form-note">由程序自动分配，不可修改</span>
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
          <button
            type="button"
            className="btn btn-sm"
            disabled={!target}
            title="连同全部步骤复制当前目录"
            onClick={() => {
              if (!target) {
                return;
              }
              const takenIds = new Set(draft.tasks.flatMap((t) => t.targets.map((x) => x.id)));
              const takenNames = new Set(task.targets.map((x) => x.name));
              const copy = duplicateTarget(target, takenIds, takenNames);
              dispatch({
                type: "PATCH_DRAFT",
                draft: updateTask(draft, task.id, (t) => {
                  const targets = [...t.targets];
                  targets.splice(t.targets.findIndex((x) => x.id === target.id) + 1, 0, copy);
                  return { ...t, targets };
                }),
              });
              dispatch({
                type: "SELECT",
                selection: { kind: "target", taskId: task.id, targetId: copy.id },
              });
              host.toast(
                copy.path === target.path
                  ? `已复制为「${copy.name}」，请改掉与原目录相同的路径`
                  : `已复制为「${copy.name}」，路径已推为 ${copy.path}`,
              );
            }}
          >
            复制当前
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
            templates={draft.stepTemplates ?? []}
            onApplyTemplate={(templateId) =>
              dispatch({
                type: "PATCH_DRAFT",
                draft: applyTemplateToTarget(draft, task.id, target.id, templateId),
              })
            }
            onDetachTemplate={() => {
              dispatch({
                type: "PATCH_DRAFT",
                draft: detachTemplateFromTarget(draft, task.id, target.id),
              });
              host.toast("已解除引用，步骤已展开为该目录独有");
            }}
            onExtractTemplate={() => {
              const name = window.prompt("新模板名称", `${target.name} 步骤`);
              if (name === null) {
                return;
              }
              const result = extractTemplateFromTarget(draft, task.id, target.id, name);
              if (!result) {
                host.toast("无法抽取模板", true);
                return;
              }
              dispatch({ type: "PATCH_DRAFT", draft: result.draft });
              dispatch({
                type: "SELECT",
                selection: { kind: "template", templateId: result.templateId },
              });
              host.toast("已抽成模板，其它目录可直接引用");
            }}
            onEditTemplate={(templateId) =>
              dispatch({ type: "SELECT", selection: { kind: "template", templateId } })
            }
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
  templates: StepTemplate[];
  onApplyTemplate: (templateId: string) => void;
  onDetachTemplate: () => void;
  onExtractTemplate: () => void;
  onEditTemplate: (templateId: string) => void;
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
    templates,
    onApplyTemplate,
    onDetachTemplate,
    onExtractTemplate,
    onEditTemplate,
    onPickFolder,
    onSelectStep,
    onChangeTarget,
    onChangeStep,
    onMoveStep,
    onDeleteTarget,
    onDeleteTask,
  } = props;
  const pathError = issueFor(`tasks.${taskId}.targets.${target.id}.path`, issues);
  const [toolPicker, setToolPicker] = useState<{ mode: "add" } | { mode: "edit"; index: number }>();
  const activeTemplate = target.usesTemplate
    ? templates.find((item) => item.id === target.usesTemplate)
    : undefined;


  const chooseTool = (toolsetId: string, tool: string) => {
    const step: EditorStep = {
      toolsetId,
      tool,
      timeout: "30m",
      params: defaultStepParams(toolsets, toolsetId, tool),
    };
    if (toolPicker?.mode === "edit") {
      const previous = target.steps[toolPicker.index];
      onChangeStep(toolPicker.index, () => ({
        ...step,
        timeout: previous?.timeout || "30m",
      }));
      onSelectStep(toolPicker.index);
    } else {
      onChangeTarget((t) => ({ ...t, steps: [...t.steps, step] }));
      onSelectStep(target.steps.length);
    }
    setToolPicker(undefined);
  };

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
          <input value={target.id} readOnly disabled className="input-readonly" />
          <span className="form-note">由程序自动分配，不可修改</span>
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
        {activeTemplate ? (
          <>
            <button
              type="button"
              className="btn btn-sm btn-quiet"
              onClick={() => onEditTemplate(activeTemplate.id)}
            >
              编辑模板
            </button>
            <button type="button" className="btn btn-sm btn-quiet" onClick={onDetachTemplate}>
              解除引用
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => setToolPicker({ mode: "add" })}
            >
              添加步骤
            </button>
            {target.steps.length > 0 && (
              <button
                type="button"
                className="btn btn-sm btn-quiet"
                title="把当前步骤抽成可复用模板"
                onClick={onExtractTemplate}
              >
                抽成模板
              </button>
            )}
          </>
        )}
      </div>

      <label className="cfg-template-pick">
        步骤来源
        <select
          value={target.usesTemplate ?? ""}
          onChange={(e) => {
            const value = e.target.value;
            if (!value) {
              onDetachTemplate();
            } else {
              onApplyTemplate(value);
            }
          }}
        >
          <option value="">此目录独有步骤</option>
          {templates.map((item) => (
            <option key={item.id} value={item.id}>
              模板：{item.name || item.id}
            </option>
          ))}
        </select>
      </label>

      {activeTemplate ? (
        <TemplateBinding
          taskId={taskId}
          target={target}
          template={activeTemplate}
          issues={issues}
          onChangeTarget={onChangeTarget}
        />
      ) : (
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
                  onChooseTool={() => setToolPicker({ mode: "edit", index })}
                  onChange={(updater) => onChangeStep(index, updater)}
                />
              )}
            </article>
          ))}
        </div>
      )}


      <div className="cfg-danger">
        <button type="button" className="btn btn-danger" onClick={onDeleteTarget}>
          删除此目标
        </button>
        <button type="button" className="btn btn-danger" onClick={onDeleteTask}>
          删除整个任务
        </button>
      </div>
      {toolPicker && (
        <ToolPicker
          toolsets={toolsets}
          title={toolPicker.mode === "add" ? "添加步骤" : "更换工具"}
          current={
            toolPicker.mode === "edit"
              ? `${target.steps[toolPicker.index]?.toolsetId}::${target.steps[toolPicker.index]?.tool}`
              : undefined
          }
          onChoose={chooseTool}
          onClose={() => setToolPicker(undefined)}
        />
      )}
    </div>
  );
}

/** 目标侧的模板绑定视图：填变量 + 看展开结果，步骤本体只能去模板里改。 */
function TemplateBinding(props: {
  taskId: string;
  target: ReturnType<typeof createTarget>;
  template: StepTemplate;
  issues: { path: string; message: string }[];
  onChangeTarget: (updater: (t: typeof props.target) => typeof props.target) => void;
}) {
  const { taskId, target, template, issues, onChangeTarget } = props;
  const preview = expandTemplate(template, target);

  return (
    <div className="cfg-template-binding">
      <p className="form-note">
        步骤来自模板「{template.name || template.id}」，共 {template.steps.length} 步。
        改动模板会同时影响所有引用它的目录。
      </p>

      {template.vars.length > 0 && (
        <div className="form-grid cfg-template-vars">
          {template.vars.map((item) => {
            const varError = issueFor(
              `tasks.${taskId}.targets.${target.id}.vars.${item.name}`,
              issues,
            );
            return (
              <label key={item.name}>
                {item.name}
                <input
                  value={target.vars?.[item.name] ?? ""}
                  placeholder={item.default ?? "（必填）"}
                  onChange={(e) =>
                    onChangeTarget((t) => ({
                      ...t,
                      vars: { ...(t.vars ?? {}), [item.name]: e.target.value },
                    }))
                  }
                />
                {item.description && <span className="form-note">{item.description}</span>}
                {varError && <span className="field-error">{varError}</span>}
              </label>
            );
          })}
        </div>
      )}

      {preview.issues.length > 0 && (
        <p className="field-error">
          {preview.issues.map((item) => item.message).join("；")}
        </p>
      )}

      <div className="rows cfg-steps cfg-steps-readonly">
        {preview.steps.map((step, index) => (
          <article key={`${step.toolsetId}/${step.tool}/${index}`} className="row-card cfg-step">
            <div className="cfg-step-head">
              <div className="cfg-step-hit">
                <div className="ws-line">
                  <h3>
                    {index + 1}. {step.tool}
                  </h3>
                  <span className="chip chip-mono">
                    {step.toolsetId}/{step.tool}
                  </span>
                  <span className="chip chip-muted">{step.timeout}</span>
                </div>
              </div>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}

/** 模板本体编辑：步骤 + 变量声明，一处改动全局生效。 */
function TemplateEditor(props: {
  template: StepTemplate;
  usedBy: Array<{ taskName: string; targetName: string }>;
  toolsets: ToolsetView[];
  issues: { path: string; message: string }[];
  selectedStepIndex: number;
  onSelectStep: (index: number) => void;
  onChange: (updater: (t: StepTemplate) => StepTemplate) => void;
  onChangeStep: (index: number, updater: (s: EditorStep) => EditorStep) => void;
  onMoveStep: (from: number, to: number) => void;
  onDelete: () => void;
}) {
  const {
    template,
    usedBy,
    toolsets,
    issues,
    selectedStepIndex,
    onSelectStep,
    onChange,
    onChangeStep,
    onMoveStep,
    onDelete,
  } = props;
  const [toolPicker, setToolPicker] = useState<{ mode: "add" } | { mode: "edit"; index: number }>();
  const missingVars = undeclaredVarNames(template);
  const usedNames = useMemo(() => [...collectVarNames(template.steps)], [template.steps]);

  const chooseTool = (toolsetId: string, tool: string) => {
    const step: EditorStep = {
      toolsetId,
      tool,
      timeout: "30m",
      params: defaultStepParams(toolsets, toolsetId, tool),
    };
    if (toolPicker?.mode === "edit") {
      const previous = template.steps[toolPicker.index];
      onChangeStep(toolPicker.index, () => ({ ...step, timeout: previous?.timeout || "30m" }));
      onSelectStep(toolPicker.index);
    } else {
      onChange((t) => ({ ...t, steps: [...t.steps, step] }));
      onSelectStep(template.steps.length);
    }
    setToolPicker(undefined);
  };

  return (
    <section className="cfg-main">
      <header className="block-head">
        <div>
          <h2>{template.name || template.id}</h2>
          <p className="form-note">步骤模板 · id: {template.id}</p>
        </div>
      </header>

      <div className="form-grid">
        <label>
          模板名称
          <input
            value={template.name}
            onChange={(e) => onChange((t) => ({ ...t, name: e.target.value }))}
          />
          {issueFor(`stepTemplates.${template.id}.name`, issues) && (
            <span className="field-error">
              {issueFor(`stepTemplates.${template.id}.name`, issues)}
            </span>
          )}
        </label>
        <label>
          ID
          <input value={template.id} readOnly disabled className="input-readonly" />
          <span className="form-note">由程序自动分配，不可修改</span>
        </label>
      </div>

      <div className="block cfg-section">
        <div className="block-head">
          <h3>变量</h3>
          <button
            type="button"
            className="btn btn-sm"
            onClick={() =>
              onChange((t) => ({
                ...t,
                vars: [...t.vars, { name: `var${t.vars.length + 1}`, default: "" }],
              }))
            }
          >
            添加变量
          </button>
        </div>
        <p className="form-note">
          步骤里写 <code>{"${变量名}"}</code> 占位，各目录引用时填自己的值。
          内置可直接用：<code>{"${target.path}"}</code>、<code>{"${target.name}"}</code>、
          <code>{"${target.id}"}</code>。
        </p>
        {missingVars.length > 0 && (
          <p className="field-error">
            步骤里用到但未声明的变量：{missingVars.join("、")}
            <button
              type="button"
              className="btn btn-sm btn-quiet"
              onClick={() =>
                onChange((t) => ({
                  ...t,
                  vars: [
                    ...t.vars,
                    ...missingVars.map((name) => ({ name, default: "" })),
                  ],
                }))
              }
            >
              全部补充声明
            </button>
          </p>
        )}
        {template.vars.length === 0 ? (
          <p className="form-note">
            还没有变量。若各目录步骤完全一致，可不用变量。
            {usedNames.length > 0 && `（步骤里已引用：${usedNames.join("、")}）`}
          </p>
        ) : (
          <div className="rows">
            {template.vars.map((item, index) => (
              <div key={index} className="form-grid cfg-var-row">
                <label>
                  名称
                  <input
                    value={item.name}
                    onChange={(e) =>
                      onChange((t) => ({
                        ...t,
                        vars: t.vars.map((v, i) =>
                          i === index ? { ...v, name: e.target.value } : v,
                        ),
                      }))
                    }
                  />
                </label>
                <label>
                  默认值
                  <input
                    value={item.default ?? ""}
                    placeholder="留空表示各目录必填"
                    onChange={(e) =>
                      onChange((t) => ({
                        ...t,
                        vars: t.vars.map((v, i) =>
                          i === index ? { ...v, default: e.target.value } : v,
                        ),
                      }))
                    }
                  />
                </label>
                <label>
                  说明
                  <input
                    value={item.description ?? ""}
                    onChange={(e) =>
                      onChange((t) => ({
                        ...t,
                        vars: t.vars.map((v, i) =>
                          i === index ? { ...v, description: e.target.value } : v,
                        ),
                      }))
                    }
                  />
                </label>
                <button
                  type="button"
                  className="btn btn-icon btn-sm btn-quiet"
                  title="删除变量"
                  aria-label="删除变量"
                  onClick={() =>
                    onChange((t) => ({ ...t, vars: t.vars.filter((_, i) => i !== index) }))
                  }
                >
                  <Icon name="trash" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="block-head">
        <h4>步骤</h4>
        <button type="button" className="btn btn-sm" onClick={() => setToolPicker({ mode: "add" })}>
          添加步骤
        </button>
      </div>
      {issueFor(`stepTemplates.${template.id}.steps`, issues) && (
        <p className="field-error">{issueFor(`stepTemplates.${template.id}.steps`, issues)}</p>
      )}

      <div className="rows cfg-steps">
        {template.steps.map((step, index) => (
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
                  disabled={index === template.steps.length - 1}
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
                    if (template.steps.length <= 1) {
                      return;
                    }
                    onChange((t) => ({ ...t, steps: t.steps.filter((_, i) => i !== index) }));
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
                onChooseTool={() => setToolPicker({ mode: "edit", index })}
                onChange={(updater) => onChangeStep(index, updater)}
              />
            )}
          </article>
        ))}
      </div>

      <div className="block cfg-section">
        <div className="block-head">
          <h3>引用情况</h3>
        </div>
        {usedBy.length === 0 ? (
          <p className="form-note">还没有目录引用这个模板。</p>
        ) : (
          <div className="cfg-target-tabs">
            {usedBy.map((item, index) => (
              <span key={index} className="chip chip-mono">
                {item.taskName} / {item.targetName}
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="cfg-danger">
        <button type="button" className="btn btn-danger" onClick={onDelete}>
          删除此模板
        </button>
      </div>

      {toolPicker && (
        <ToolPicker
          toolsets={toolsets}
          title={toolPicker.mode === "add" ? "添加步骤" : "更换工具"}
          current={
            toolPicker.mode === "edit"
              ? `${template.steps[toolPicker.index]?.toolsetId}::${template.steps[toolPicker.index]?.tool}`
              : undefined
          }
          onChoose={chooseTool}
          onClose={() => setToolPicker(undefined)}
        />
      )}
    </section>
  );
}

type ToolChoice = {

  key: string;
  toolsetId: string;
  toolsetName: string;
  toolId: string;
  displayName: string;
  description?: string;
  category: string;
};

function toolCategory(toolsetId: string, toolId: string): string {
  const id = toolId.toLowerCase();
  if (id.startsWith("svn-")) return "SVN";
  if (id.startsWith("git-")) return "Git";
  if (id.includes("unity")) return "Unity";
  if (id.includes("cmake")) return "CMake";
  if (id.includes("proto")) return "Protobuf";
  if (id.includes("revert") || id.includes("asset")) return "资源处理";
  if (id.includes("script")) return "脚本";
  return toolsetId === "builtin" ? "其他" : "工程工具";
}

function ToolPicker({
  toolsets,
  title,
  current,
  onChoose,
  onClose,
}: {
  toolsets: ToolsetView[];
  title: string;
  current?: string;
  onChoose: (toolsetId: string, toolId: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const tools = useMemo<ToolChoice[]>(
    () =>
      toolsets.flatMap((toolset) =>
        toolset.tools.map((tool) => ({
          key: `${toolset.id}::${tool.id}`,
          toolsetId: toolset.id,
          toolsetName: toolset.displayName,
          toolId: tool.id,
          displayName: tool.displayName,
          description: tool.description,
          category: toolCategory(toolset.id, tool.id),
        })),
      ),
    [toolsets],
  );
  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    if (!needle) return tools;
    return tools.filter((tool) =>
      [
        tool.displayName,
        tool.toolId,
        tool.description,
        tool.toolsetName,
        tool.category,
      ]
        .filter(Boolean)
        .some((value) => value!.toLocaleLowerCase().includes(needle)),
    );
  }, [query, tools]);
  const grouped = useMemo(() => {
    const groups = new Map<string, Map<string, ToolChoice[]>>();
    for (const tool of filtered) {
      const categories = groups.get(tool.toolsetName) ?? new Map<string, ToolChoice[]>();
      const items = categories.get(tool.category) ?? [];
      items.push(tool);
      categories.set(tool.category, items);
      groups.set(tool.toolsetName, categories);
    }
    return groups;
  }, [filtered]);

  useEffect(() => {
    searchRef.current?.focus();
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  return (
    <div
      className="cfg-tool-picker-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section className="cfg-tool-picker" role="dialog" aria-modal="true" aria-label={title}>
        <header className="cfg-tool-picker-head">
          <div>
            <h3>{title}</h3>
            <p className="form-note">搜索或按类别选择要执行的工具</p>
          </div>
          <button type="button" className="btn btn-quiet btn-sm" onClick={onClose}>
            关闭
          </button>
        </header>
        <input
          ref={searchRef}
          className="cfg-tool-search"
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="搜索工具名称、ID 或说明…"
          aria-label="搜索工具"
        />
        <div className="cfg-tool-results">
          {[...grouped].map(([toolsetName, categories]) => (
            <section className="cfg-toolset-group" key={toolsetName}>
              <h4>{toolsetName}</h4>
              {[...categories].map(([category, items]) => (
                <div className="cfg-tool-category" key={category}>
                  <div className="cfg-tool-category-name">{category}</div>
                  <div className="cfg-tool-grid">
                    {items.map((tool) => (
                      <button
                        type="button"
                        className={`cfg-tool-option${current === tool.key ? " is-current" : ""}`}
                        key={tool.key}
                        onClick={() => onChoose(tool.toolsetId, tool.toolId)}
                      >
                        <span className="cfg-tool-option-title">
                          <strong>{tool.displayName}</strong>
                          {current === tool.key && <span className="chip chip-muted">当前</span>}
                        </span>
                        <small>{tool.description || tool.toolId}</small>
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </section>
          ))}
          {filtered.length === 0 && (
            <div className="cfg-tool-empty">
              <strong>没有匹配的工具</strong>
              <span>尝试名称、工具 ID 或类别，例如 Git、SVN、Unity。</span>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

function StepForm({
  step,
  toolsets,
  onChooseTool,
  onChange,
}: {
  step: EditorStep;
  toolsets: ToolsetView[];
  onChooseTool: () => void;
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
        <button
          type="button"
          className="cfg-tool-current"
          onClick={onChooseTool}
          aria-label="更换工具"
        >
          <span>
            <strong>{current?.label ?? step.tool}</strong>
            <small>{step.toolsetId}/{step.tool}</small>
          </span>
          <span className="cfg-tool-change">更换</span>
        </button>
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
          checked={value === true || (value === undefined && param.default === true)}
          onChange={(e) => onChange(e.target.checked)}
        />
        {param.description || param.name}
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

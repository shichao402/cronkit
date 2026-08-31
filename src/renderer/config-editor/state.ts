import type {
  ConfigEditorPayload,
  ConfigIssue,
  EditorDraft,
  EditorStep,
  EditorTarget,
  EditorTask,
  EditorTrigger,
  StepTemplate,
  ToolsetView,
} from "../../shared/types";
import { collectVarNames, expandTemplate } from "../../shared/step-template";
import { nextRuns } from "./cron";


export type Selection =
  | { kind: "task"; taskId: string }
  | { kind: "target"; taskId: string; targetId: string }
  | { kind: "step"; taskId: string; targetId: string; stepIndex: number }
  | { kind: "template"; templateId: string }
  | { kind: "templateStep"; templateId: string; stepIndex: number }
  | { kind: "runtime" }
  | { kind: "none" };

/** 配置页左栏的子页签。任务与模板各自独立成页，默认进任务配置。 */
export type RailTab = "tasks" | "templates";

/** 选中项属于哪个页签；用于选中变化时自动把页签切到对应的一栏。 */
export function tabForSelection(selection: Selection): RailTab | null {
  if (selection.kind === "template" || selection.kind === "templateStep") {
    return "templates";
  }
  if (selection.kind === "task" || selection.kind === "target" || selection.kind === "step") {
    return "tasks";
  }
  return null;
}


export type EditorState = {
  path: string;
  revision: string;
  draft: EditorDraft | null;
  dirty: boolean;
  parseError?: string;
  toolsets: ToolsetView[];
  selection: Selection;
  railTab: RailTab;
  issues: ConfigIssue[];
  historyPast: EditorDraft[];
  historyFuture: EditorDraft[];
  conflict?: { diskRevision: string; diskText: string };
  saving: boolean;
};

export type EditorAction =
  | { type: "LOAD"; payload: ConfigEditorPayload }
  | { type: "SELECT"; selection: Selection }
  | { type: "SET_RAIL_TAB"; tab: RailTab }
  | { type: "PATCH_DRAFT"; draft: EditorDraft; pushHistory?: boolean }

  | { type: "SET_ISSUES"; issues: ConfigIssue[] }
  | { type: "SET_DIRTY"; dirty: boolean }
  | { type: "SET_SAVING"; saving: boolean }
  | { type: "SET_CONFLICT"; conflict?: { diskRevision: string; diskText: string } }
  | { type: "SET_REVISION"; revision: string }
  | { type: "UNDO" }
  | { type: "REDO" }
  | { type: "MARK_SAVED"; revision: string; draft: EditorDraft };

const HISTORY_LIMIT = 50;

export function emptyDraft(): EditorDraft {
  return {
    version: 2,
    timezone: "Asia/Shanghai",
    runtime: {
      maxConcurrentRuns: 1,
      catchUpPreviousDays: 0,
      retryFailedOnCatchUp: false,
      releaseOccupants: true,
      releaseGraceMs: 20_000,
    },
    tasks: [],
    stepTemplates: [],
    reporting: { enabled: false, on: [] },
    brain: { enabled: false },
  };
}


export function createInitialState(): EditorState {
  return {
    path: "",
    revision: "",
    draft: null,
    dirty: false,
    toolsets: [],
    selection: { kind: "none" },
    railTab: "tasks",
    issues: [],
    historyPast: [],
    historyFuture: [],
    saving: false,
  };
}


function cloneDraft(draft: EditorDraft): EditorDraft {
  return structuredClone(draft);
}

function pushPast(state: EditorState, draft: EditorDraft): EditorDraft[] {
  const next = [...state.historyPast, cloneDraft(draft)];
  if (next.length > HISTORY_LIMIT) {
    next.shift();
  }
  return next;
}

export function editorReducer(state: EditorState, action: EditorAction): EditorState {
  switch (action.type) {
    case "LOAD": {
      const { payload } = action;
      const draft = payload.draft ? cloneDraft(payload.draft) : null;
      const firstTask = draft?.tasks[0];
      return {
        ...createInitialState(),
        path: payload.path,
        revision: payload.revision,
        draft,
        parseError: payload.parseError,
        toolsets: payload.toolsets,
        selection: firstTask
          ? { kind: "task", taskId: firstTask.id }
          : { kind: "none" },
        railTab: "tasks",
        dirty: false,
      };
    }
    case "SELECT": {
      // 选中模板/任务时把页签一并切过去，避免选中项与当前页签不一致。
      const tab = tabForSelection(action.selection);
      return { ...state, selection: action.selection, railTab: tab ?? state.railTab };
    }
    case "SET_RAIL_TAB": {
      if (action.tab === state.railTab) {
        return state;
      }
      // 切页签时把主面板一起带过去：落到该栏的第一项，没有内容就留空态。
      // 否则左栏列的是模板、右侧还显示任务表单，两边对不上。
      const keep = tabForSelection(state.selection) === action.tab;
      if (keep) {
        return { ...state, railTab: action.tab };
      }
      const draft = state.draft;
      let selection: Selection = { kind: "none" };
      if (action.tab === "tasks") {
        const first = draft?.tasks[0];
        selection = first ? { kind: "task", taskId: first.id } : { kind: "none" };
      } else {
        const first = draft?.stepTemplates?.[0];
        selection = first ? { kind: "template", templateId: first.id } : { kind: "none" };
      }
      return { ...state, railTab: action.tab, selection };
    }


    case "PATCH_DRAFT": {
      if (!state.draft) {
        return state;
      }
      return {
        ...state,
        historyPast: action.pushHistory === false ? state.historyPast : pushPast(state, state.draft),
        historyFuture: action.pushHistory === false ? state.historyFuture : [],
        draft: cloneDraft(action.draft),
        dirty: true,
      };
    }
    case "SET_ISSUES":
      return { ...state, issues: action.issues };
    case "SET_DIRTY":
      return { ...state, dirty: action.dirty };
    case "SET_SAVING":
      return { ...state, saving: action.saving };
    case "SET_CONFLICT":
      return { ...state, conflict: action.conflict };
    case "SET_REVISION":
      return { ...state, revision: action.revision };
    case "UNDO": {
      if (!state.draft || state.historyPast.length === 0) {
        return state;
      }
      const past = [...state.historyPast];
      const prev = past.pop()!;
      return {
        ...state,
        historyPast: past,
        historyFuture: [cloneDraft(state.draft), ...state.historyFuture],
        draft: prev,
        dirty: true,
      };
    }
    case "REDO": {
      if (!state.draft || state.historyFuture.length === 0) {
        return state;
      }
      const [next, ...rest] = state.historyFuture;
      return {
        ...state,
        historyPast: pushPast(state, state.draft),
        historyFuture: rest,
        draft: cloneDraft(next),
        dirty: true,
      };
    }
    case "MARK_SAVED":
      return {
        ...state,
        revision: action.revision,
        draft: cloneDraft(action.draft),
        dirty: false,
        saving: false,
        conflict: undefined,
        parseError: undefined,
        historyPast: [],
        historyFuture: [],
      };
    default:
      return state;
  }
}

export function uniqueId(base: string, taken: Set<string>): string {
  if (!taken.has(base)) {
    return base;
  }
  let i = 2;
  while (taken.has(`${base}-${i}`)) {
    i += 1;
  }
  return `${base}-${i}`;
}

/** 程序自动分配的 id：不可由用户编辑，只保证全局唯一且稳定。 */
export function autoId(prefix: string, taken: Set<string>): string {
  let i = 1;
  while (taken.has(`${prefix}-${i}`)) {
    i += 1;
  }
  return `${prefix}-${i}`;
}

export function createTask(existing: EditorTask[]): EditorTask {
  const taken = new Set(existing.map((t) => t.id));
  const id = autoId("task", taken);
  const targetId = autoId("target", new Set(existing.flatMap((t) => t.targets.map((x) => x.id))));
  return {
    id,
    name: "新自动化任务",
    enabled: true,
    trigger: { type: "cron", cron: "10 2 * * *" },
    targets: [
      {
        id: targetId,
        name: "工作目录",
        path: "",
        oncePerDay: true,
        steps: [
          {
            toolsetId: "builtin",
            tool: "svn-update",
            timeout: "2h",
            params: { strategy: "follow-latest" },
          },
        ],
      },
    ],
  };
}

export function createTarget(existingIds: Set<string>): EditorTarget {
  const id = autoId("target", existingIds);
  return {
    id,
    name: "工作目录",
    path: "",
    oncePerDay: true,
    steps: [
      {
        toolsetId: "builtin",
        tool: "svn-update",
        timeout: "30m",
        params: { strategy: "follow-latest" },
      },
    ],
  };
}


/** `OSGameCoreOnly4` → `OSGameCoreOnly5`；结尾没有数字时返回 undefined。 */
function bumpTrailingNumber(value: string): string | undefined {
  const match = /^(.*?)(\d+)$/.exec(value);
  if (!match) {
    return undefined;
  }
  const [, prefix, digits] = match;
  const next = String(Number(digits) + 1);
  return prefix + next.padStart(digits.length, "0");
}

function nextFreeName(value: string, taken: Set<string>, fallbackSuffix: string): string {
  let candidate = bumpTrailingNumber(value);
  while (candidate !== undefined && taken.has(candidate)) {
    candidate = bumpTrailingNumber(candidate);
  }
  return candidate ?? uniqueId(`${value}${fallbackSuffix}`, taken);
}

/**
 * 复制目标：步骤整份带走，显示名/路径的结尾序号自动加一，
 * id 由程序另行分配（用户不可编辑）。
 */
export function duplicateTarget(
  source: EditorTarget,
  takenIds: Set<string>,
  takenNames: Set<string>,
): EditorTarget {
  return {
    ...structuredClone(source),
    id: autoId("target", takenIds),
    name: nextFreeName(source.name, takenNames, " 副本"),
    path: bumpTrailingNumber(source.path.replace(/\/+$/, "")) ?? source.path,
  };
}


export function defaultStepParams(
  toolsets: ToolsetView[],
  toolsetId: string,
  tool: string,
): Record<string, unknown> {
  const ts = toolsets.find((item) => item.id === toolsetId);
  const manifest = ts?.tools.find((item) => item.id === tool);
  const params: Record<string, unknown> = {};
  for (const param of manifest?.params ?? []) {
    if (param.default !== undefined) {
      params[param.name] = param.default;
    }
  }
  return params;
}

export function findTask(draft: EditorDraft, taskId: string): EditorTask | undefined {
  return draft.tasks.find((t) => t.id === taskId);
}

export function findTarget(
  draft: EditorDraft,
  taskId: string,
  targetId: string,
): EditorTarget | undefined {
  return findTask(draft, taskId)?.targets.find((t) => t.id === targetId);
}

export function updateTask(
  draft: EditorDraft,
  taskId: string,
  updater: (task: EditorTask) => EditorTask,
): EditorDraft {
  return {
    ...draft,
    tasks: draft.tasks.map((task) => (task.id === taskId ? updater(task) : task)),
  };
}

export function updateTarget(
  draft: EditorDraft,
  taskId: string,
  targetId: string,
  updater: (target: EditorTarget) => EditorTarget,
): EditorDraft {
  return updateTask(draft, taskId, (task) => ({
    ...task,
    targets: task.targets.map((target) => (target.id === targetId ? updater(target) : target)),
  }));
}

export function updateStep(
  draft: EditorDraft,
  taskId: string,
  targetId: string,
  stepIndex: number,
  updater: (step: EditorStep) => EditorStep,
): EditorDraft {
  return updateTarget(draft, taskId, targetId, (target) => ({
    ...target,
    steps: target.steps.map((step, index) => (index === stepIndex ? updater(step) : step)),
  }));
}

/* ---------------- 步骤模板 ---------------- */

export function findTemplate(draft: EditorDraft, templateId: string): StepTemplate | undefined {
  return (draft.stepTemplates ?? []).find((item) => item.id === templateId);
}

export function createTemplate(existing: StepTemplate[]): StepTemplate {
  const id = autoId("tpl", new Set(existing.map((item) => item.id)));
  return {
    id,
    name: "新步骤模板",
    vars: [],
    steps: [
      {
        toolsetId: "builtin",
        tool: "svn-update",
        timeout: "2h",
        params: { strategy: "follow-latest" },
      },
    ],
  };
}

export function addTemplate(draft: EditorDraft, template: StepTemplate): EditorDraft {
  return { ...draft, stepTemplates: [...(draft.stepTemplates ?? []), template] };
}

export function updateTemplate(
  draft: EditorDraft,
  templateId: string,
  updater: (template: StepTemplate) => StepTemplate,
): EditorDraft {
  return {
    ...draft,
    stepTemplates: (draft.stepTemplates ?? []).map((item) =>
      item.id === templateId ? updater(item) : item,
    ),
  };
}

/** 删除模板：把仍在引用它的目标回填为展开后的自有步骤，避免配置变成非法。 */
export function deleteTemplate(draft: EditorDraft, templateId: string): EditorDraft {
  const template = findTemplate(draft, templateId);
  const tasks = draft.tasks.map((task) => ({
    ...task,
    targets: task.targets.map((target) => {
      if (target.usesTemplate !== templateId) {
        return target;
      }
      const steps = template ? expandTemplate(template, target).steps : target.steps;
      const { usesTemplate: _drop, vars: _dropVars, ...rest } = target;
      return { ...rest, steps };
    }),
  }));
  return {
    ...draft,
    tasks,
    stepTemplates: (draft.stepTemplates ?? []).filter((item) => item.id !== templateId),
  };
}

export function updateTemplateStep(
  draft: EditorDraft,
  templateId: string,
  stepIndex: number,
  updater: (step: EditorStep) => EditorStep,
): EditorDraft {
  return updateTemplate(draft, templateId, (template) => ({
    ...template,
    steps: template.steps.map((step, index) => (index === stepIndex ? updater(step) : step)),
  }));
}

export function moveTemplateStep(
  draft: EditorDraft,
  templateId: string,
  from: number,
  to: number,
): EditorDraft {
  return updateTemplate(draft, templateId, (template) => {
    if (to < 0 || to >= template.steps.length || from === to) {
      return template;
    }
    const steps = [...template.steps];
    const [item] = steps.splice(from, 1);
    steps.splice(to, 0, item);
    return { ...template, steps };
  });
}

/** 模板步骤里引用到、但尚未声明的变量名（排除 target.* 内置量）。 */
export function undeclaredVarNames(template: StepTemplate): string[] {
  const declared = new Set(template.vars.map((item) => item.name));
  return [...collectVarNames(template.steps)].filter(
    (name) => !declared.has(name) && !name.startsWith("target."),
  );
}

/**
 * 以某个目标现有步骤为蓝本抽出模板，并把该目标改为引用它。
 * 步骤里出现的目标路径会被换成 `${target.path}`，避免模板写死单个目录。
 */
export function extractTemplateFromTarget(
  draft: EditorDraft,
  taskId: string,
  targetId: string,
  name: string,
): { draft: EditorDraft; templateId: string } | undefined {
  const target = findTarget(draft, taskId, targetId);
  if (!target || target.usesTemplate) {
    return undefined;
  }
  const template = createTemplate(draft.stepTemplates ?? []);
  const steps = structuredClone(target.steps).map((step) =>
    replacePathLiteral(step, target.path),
  );
  const next: StepTemplate = { ...template, name: name.trim() || template.name, steps };
  let out = addTemplate(draft, next);
  out = updateTarget(out, taskId, targetId, (t) => {
    const { steps: _drop, ...rest } = t;
    return { ...rest, steps: [], usesTemplate: next.id, vars: {} };
  });
  return { draft: out, templateId: next.id };
}

function replacePathLiteral(step: EditorStep, targetPath: string): EditorStep {
  if (!targetPath) {
    return step;
  }
  const swap = (value: unknown): unknown => {
    if (typeof value === "string") {
      return value.split(targetPath).join("${target.path}");
    }
    if (Array.isArray(value)) {
      return value.map(swap);
    }
    if (value && typeof value === "object") {
      return Object.fromEntries(
        Object.entries(value).map(([key, item]) => [key, swap(item)]),
      );
    }
    return value;
  };
  return { ...step, params: swap(step.params) as Record<string, unknown> };
}

/** 把模板套到目标上：清空自有步骤，改为引用。 */
export function applyTemplateToTarget(
  draft: EditorDraft,
  taskId: string,
  targetId: string,
  templateId: string,
): EditorDraft {
  return updateTarget(draft, taskId, targetId, (target) => ({
    ...target,
    usesTemplate: templateId,
    vars: target.vars ?? {},
    steps: [],
  }));
}

/** 解除引用：把模板展开成该目标的自有步骤，之后可单独改。 */
export function detachTemplateFromTarget(
  draft: EditorDraft,
  taskId: string,
  targetId: string,
): EditorDraft {
  const target = findTarget(draft, taskId, targetId);
  if (!target?.usesTemplate) {
    return draft;
  }
  const template = findTemplate(draft, target.usesTemplate);
  const steps = template ? expandTemplate(template, target).steps : [];
  return updateTarget(draft, taskId, targetId, (t) => {
    const { usesTemplate: _drop, vars: _dropVars, ...rest } = t;
    return { ...rest, steps };
  });
}


export function moveStep(
  draft: EditorDraft,
  taskId: string,
  targetId: string,
  from: number,
  to: number,
): EditorDraft {
  return updateTarget(draft, taskId, targetId, (target) => {
    if (to < 0 || to >= target.steps.length || from === to) {
      return target;
    }
    const steps = [...target.steps];
    const [item] = steps.splice(from, 1);
    steps.splice(to, 0, item);
    return { ...target, steps };
  });
}

export function setTrigger(task: EditorTask, trigger: EditorTrigger): EditorTask {
  return { ...task, trigger };
}

export function validateDraftLocally(draft: EditorDraft): ConfigIssue[] {
  const issues: ConfigIssue[] = [];
  const taskIds = new Set<string>();
  const targetIds = new Set<string>();
  const templates = draft.stepTemplates ?? [];
  const templateIds = new Set<string>();

  for (const template of templates) {
    if (templateIds.has(template.id)) {
      issues.push({
        path: `stepTemplates.${template.id}`,
        level: "error",
        message: "步骤模板 id 重复",
      });
    }
    templateIds.add(template.id);
    if (!template.name.trim()) {
      issues.push({
        path: `stepTemplates.${template.id}.name`,
        level: "error",
        message: "请填写模板名称",
      });
    }
    if (template.steps.length === 0) {
      issues.push({
        path: `stepTemplates.${template.id}.steps`,
        level: "error",
        message: "模板至少需要一个步骤",
      });
    }
  }

  if (draft.tasks.length === 0) {
    issues.push({ path: "tasks", level: "error", message: "至少需要一个自动化任务" });
  }
  for (const task of draft.tasks) {
    if (!task.id.trim()) {
      issues.push({ path: `tasks.`, level: "error", message: "任务 id 不能为空" });
    }
    if (taskIds.has(task.id)) {
      issues.push({ path: `tasks.${task.id}`, level: "error", message: "任务 id 重复" });
    }
    taskIds.add(task.id);
    if (!task.name.trim()) {
      issues.push({ path: `tasks.${task.id}.name`, level: "error", message: "请填写任务名称" });
    }
    if (task.trigger.type === "cron") {
      const cron = task.trigger.cron.trim();
      if (!cron) {
        issues.push({
          path: `tasks.${task.id}.trigger.cron`,
          level: "error",
          message: "请填写 cron 表达式",
        });
      } else if (nextRuns(cron, draft.timezone, 1).length === 0) {
        issues.push({
          path: `tasks.${task.id}.trigger.cron`,
          level: "error",
          message: "cron 表达式无效，无法推算运行时间",
        });
      }
    }
    if (task.targets.length === 0) {
      issues.push({
        path: `tasks.${task.id}.targets`,
        level: "error",
        message: "任务至少需要一个目标目录",
      });
    }
    for (const target of task.targets) {
      if (targetIds.has(target.id)) {
        issues.push({
          path: `tasks.${task.id}.targets.${target.id}`,
          level: "error",
          message: "目标 id 全局不能重复",
        });
      }
      targetIds.add(target.id);
      if (!target.path.trim()) {
        issues.push({
          path: `tasks.${task.id}.targets.${target.id}.path`,
          level: "error",
          message: "请选择工作目录路径",
        });
      }
      if (target.usesTemplate) {
        const template = templates.find((item) => item.id === target.usesTemplate);
        if (!template) {
          issues.push({
            path: `tasks.${task.id}.targets.${target.id}.usesTemplate`,
            level: "error",
            message: `引用的步骤模板不存在: ${target.usesTemplate}`,
          });
        } else {
          const { issues: expandIssues } = expandTemplate(template, target);
          for (const item of expandIssues) {
            issues.push({
              path: `tasks.${task.id}.targets.${target.id}.vars.${item.name}`,
              level: "error",
              message: item.message,
            });
          }
        }
      } else if (target.steps.length === 0) {
        issues.push({
          path: `tasks.${task.id}.targets.${target.id}.steps`,
          level: "error",
          message: "目标至少需要一个步骤，或引用一个步骤模板",
        });
      }
    }
  }
  return issues;
}


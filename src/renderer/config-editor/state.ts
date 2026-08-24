import type {
  ConfigEditorPayload,
  ConfigIssue,
  EditorDraft,
  EditorStep,
  EditorTarget,
  EditorTask,
  EditorTrigger,
  ToolsetView,
} from "../../shared/types";
import { nextRuns } from "./cron";

export type Selection =
  | { kind: "task"; taskId: string }
  | { kind: "target"; taskId: string; targetId: string }
  | { kind: "step"; taskId: string; targetId: string; stepIndex: number }
  | { kind: "runtime" }
  | { kind: "none" };

export type EditorState = {
  path: string;
  revision: string;
  draft: EditorDraft | null;
  dirty: boolean;
  parseError?: string;
  toolsets: ToolsetView[];
  selection: Selection;
  issues: ConfigIssue[];
  historyPast: EditorDraft[];
  historyFuture: EditorDraft[];
  conflict?: { diskRevision: string; diskText: string };
  saving: boolean;
};

export type EditorAction =
  | { type: "LOAD"; payload: ConfigEditorPayload }
  | { type: "SELECT"; selection: Selection }
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
        dirty: false,
      };
    }
    case "SELECT":
      return { ...state, selection: action.selection };
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

export function createTask(existing: EditorTask[]): EditorTask {
  const taken = new Set(existing.map((t) => t.id));
  const id = uniqueId("task", taken);
  const targetId = uniqueId("target", new Set());
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
  const id = uniqueId("target", existingIds);
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
 * 复制目标：步骤整份带走，id/显示名/路径的结尾序号自动加一，
 * 让 `OSGameCoreOnly4` 复制出 `OSGameCoreOnly5` 时无需逐项重填。
 */
export function duplicateTarget(
  source: EditorTarget,
  takenIds: Set<string>,
  takenNames: Set<string>,
): EditorTarget {
  return {
    ...structuredClone(source),
    id: nextFreeName(source.id, takenIds, "-copy"),
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
      if (target.steps.length === 0) {
        issues.push({
          path: `tasks.${task.id}.targets.${target.id}.steps`,
          level: "error",
          message: "目标至少需要一个步骤",
        });
      }
    }
  }
  return issues;
}

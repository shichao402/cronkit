export type RunStatus =
  | "pending"
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "skipped";

export type Trigger = "schedule" | "catch-up" | "manual";

/** What the user picked in settings. */
export type ThemePref = "system" | "light" | "dark";

/** What actually renders — `system` is resolved against the OS before it gets here. */
export type ResolvedTheme = "light" | "dark";

export type TrayState = "idle" | "running" | "failed" | "paused";

export type StepRecord = {
  index: number;
  type: string;
  status: RunStatus;
  summary: string;
  startedAt?: string;
  finishedAt?: string;
  exitCode?: number | null;
  logFile?: string;
  error?: string;
  outputTail?: string;
};

export type RunRecord = {
  runId: string;
  /** Target id (historically workspaceId). */
  workspaceId: string;
  workspaceName: string;
  /** Task id (historically scheduleId). */
  scheduleId: string;
  taskId?: string;
  taskName?: string;
  localDate: string;
  keyedTail?: string;
  trigger: Trigger;
  status: RunStatus;
  startedAt: string;
  finishedAt?: string;
  steps: StepRecord[];
};

/** Dashboard row — one planned target under a task. */
export type WorkspaceView = {
  id: string;
  name: string;
  path: string;
  autoScheduled: boolean;
  scheduleId: string;
  taskId: string;
  taskName: string;
  cron: string;
  nextRun: string | null;
  lastRun?: RunRecord;
  running: boolean;
  steps: string[];
};

export type Snapshot = {
  configPath: string;
  dataDir: string;
  configError?: string;
  timezone: string;
  appState: "idle" | "running" | "failed";
  schedulerEnabled: boolean;
  openAtLogin: boolean;
  theme: ThemePref;
  resolvedTheme: ResolvedTheme;
  exitWarnsRunning?: boolean;
  toolsets?: ToolsetView[];
  workspaces: WorkspaceView[];
  runs: RunRecord[];
};

export type ToolParamView = {
  name: string;
  type: "string" | "number" | "boolean" | "string[]" | "enum";
  required?: boolean;
  default?: unknown;
  enum?: string[];
  description?: string;
};

export type ToolsetView = {
  id: string;
  displayName: string;
  root: string;
  repo?: string;
  schemaVersion: number;
  sha?: string;
  installed: boolean;
  depsReady: boolean;
  error?: string;
  tools: Array<{
    id: string;
    displayName: string;
    description?: string;
    params?: ToolParamView[];
  }>;
};

export type EditorStep = {
  toolsetId: string;
  tool: string;
  timeout: string;
  retry?: number;
  continueOnError?: boolean;
  path?: string;
  args?: string[];
  params: Record<string, unknown>;
};

/** 模板声明的变量：目标引用模板时按名字填值，未填则用 default。 */
export type TemplateVar = {
  name: string;
  default?: string;
  description?: string;
};

/**
 * 可复用的步骤序列。目标通过 `usesTemplate` 引用，
 * 步骤内可用 `${var}` 占位，展开时以目标提供的 vars 替换。
 */
export type StepTemplate = {
  id: string;
  name: string;
  vars: TemplateVar[];
  steps: EditorStep[];
};

export type EditorTarget = {
  id: string;
  name: string;
  path: string;
  oncePerDay: boolean;
  /** 引用的步骤模板 id；为空表示使用自有 steps。 */
  usesTemplate?: string;
  /** 模板变量取值，仅在 usesTemplate 存在时有意义。 */
  vars?: Record<string, string>;
  steps: EditorStep[];
};


export type EditorTrigger =
  | { type: "cron"; cron: string }
  | { type: "manual" };

export type EditorTask = {
  id: string;
  name: string;
  enabled: boolean;
  trigger: EditorTrigger;
  targets: EditorTarget[];
};

export type EditorDraft = {
  version: 2;
  timezone: string;
  runtime: {
    maxConcurrentRuns: number;
    catchUpPreviousDays: number;
    retryFailedOnCatchUp: boolean;
    releaseOccupants?: boolean;
    releaseGraceMs?: number;
  };
  /** 可复用步骤模板库，跨任务共享。 */
  stepTemplates: StepTemplate[];
  tasks: EditorTask[];
  reporting: Record<string, unknown>;
  brain: Record<string, unknown>;
};


export type ConfigIssue = {
  path: string;
  level: "error" | "warning";
  message: string;
};

export type ConfigEditorPayload = {
  path: string;
  text: string;
  revision: string;
  draft?: EditorDraft;
  parseError?: string;
  migratedFromV1?: boolean;
  migrationWarnings?: string[];
  toolsets: ToolsetView[];
};

export type SaveConfigResult =
  | { ok: true; snapshot: Snapshot; revision: string }
  | {
      ok: false;
      reason: "conflict" | "validation" | "error";
      error?: string;
      issues?: ConfigIssue[];
      diskRevision?: string;
      diskText?: string;
    };

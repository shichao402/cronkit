export type RunStatus =
  | "pending"
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "skipped";

export type Trigger = "schedule" | "catch-up" | "manual";

export type IconTheme = "light" | "dark";

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
  workspaceId: string;
  workspaceName: string;
  scheduleId: string;
  localDate: string;
  keyedTail?: string;
  trigger: Trigger;
  status: RunStatus;
  startedAt: string;
  finishedAt?: string;
  steps: StepRecord[];
};

export type WorkspaceView = {
  id: string;
  name: string;
  path: string;
  autoScheduled: boolean;
  scheduleId: string;
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
  iconTheme: IconTheme;
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
  params: Record<string, unknown>;
};

export type EditorWorkspace = {
  id: string;
  name: string;
  path: string;
  oncePerDay: boolean;
  steps: EditorStep[];
};

export type EditorSchedule = {
  id: string;
  description?: string;
  cron: string;
  workspaceIds: string[];
};

export type EditorDraft = {
  version: 1;
  timezone: string;
  runtime: {
    maxConcurrentRuns: number;
    catchUpPreviousDays: number;
    retryFailedOnCatchUp: boolean;
    releaseOccupants?: boolean;
    releaseGraceMs?: number;
  };
  schedules: EditorSchedule[];
  workspaces: EditorWorkspace[];
  reporting: Record<string, unknown>;
  brain: Record<string, unknown>;
};

export type ConfigEditorPayload = {
  path: string;
  text: string;
  draft?: EditorDraft;
  parseError?: string;
  toolsets: ToolsetView[];
};

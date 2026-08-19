export type RunStatus =
  | "pending"
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "skipped";

export type Trigger = "schedule" | "catch-up" | "manual";

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
  workspaces: WorkspaceView[];
  runs: RunRecord[];
};

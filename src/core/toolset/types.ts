/** Toolset schema supported by this cronkit build. */
export const SUPPORTED_SCHEMA_VERSION = 1;

export type ParamType = "string" | "number" | "boolean" | "string[]" | "enum";

export type ToolParamSpec = {
  name: string;
  type: ParamType;
  required?: boolean;
  default?: unknown;
  enum?: string[];
  description?: string;
};

export type ToolManifest = {
  id: string;
  displayName: string;
  description?: string;
  params?: ToolParamSpec[];
  idempotent?: boolean;
  requiresExclusiveWorkspace?: boolean;
  remoteWrite?: boolean;
  supportsDryRun?: boolean;
  supportsResultJson?: boolean;
  allowRawArgs?: boolean;
  lowPriority?: boolean;
};

export type ToolsetManifest = {
  id: string;
  displayName: string;
  schemaVersion: number;
  entry?: string;
  tools: ToolManifest[];
};

export type ToolInvocation = {
  toolsetId: string;
  tool: string;
  params: Record<string, unknown>;
  rawArgs?: string[];
  path?: string;
  timeout: string;
  retry?: number;
  continueOnError?: boolean;
};

export type ToolRunContext = {
  cwd: string;
  timeoutMs: number;
  logFile: string;
  abortSignal: AbortSignal;
  dryRun?: boolean;
  resultJsonPath?: string;
  localDate?: string;
  workspacePath: string;
};

export type ToolRunResult = {
  detail: string;
  code: number | null;
  skipped?: boolean;
};

export type InstalledToolsetInfo = {
  id: string;
  displayName: string;
  root: string;
  repo?: string;
  schemaVersion: number;
  sha?: string;
  installed: boolean;
  depsReady: boolean;
  error?: string;
  tools: ToolManifest[];
};

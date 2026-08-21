import { mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import { configPathIn, defaultDataDir } from "./paths";
import {
  normalizeStep,
  resolveTool,
  type ToolInvocation,
  validateInvocationParams,
} from "./toolset";

const timeoutSchema = z
  .string()
  .regex(/^\d+(ms|s|m|h)$/, "timeout 形如 90m / 2h / 15s");

const hhmm = z.string().regex(/^\d{2}:\d{2}$/, "时间形如 00:00");

/** Unified toolset step. */
const toolsetStepSchema = z.object({
  type: z.literal("toolset"),
  toolsetId: z.string().min(1),
  tool: z.string().min(1),
  with: z.record(z.string(), z.unknown()).default({}),
  args: z.array(z.string()).optional(),
  path: z.string().optional(),
  timeout: timeoutSchema,
  retry: z.number().int().min(0).optional(),
  continueOnError: z.boolean().optional(),
});

/** Legacy aliases kept so existing night configs keep working. */
const svnStepSchema = z.object({
  type: z.literal("svn-update"),
  strategy: z.enum(["follow-latest", "manual", "disabled"]),
  timeout: timeoutSchema,
  path: z.string().optional(),
  retry: z.number().int().min(0).optional(),
  continueOnError: z.boolean().optional(),
  onConflict: z.enum(["fail", "revert"]).default("fail"),
  backupOnRevert: z.boolean().default(true),
  backupDir: z.string().optional(),
});

const unityStepSchema = z.object({
  type: z.literal("unity-warmup"),
  timeout: timeoutSchema,
  path: z.string().optional(),
  nographics: z.boolean().optional(),
  executeMethod: z.string().nullable().optional(),
  continueOnError: z.boolean().optional(),
  retry: z.number().int().min(0).optional(),
});

const scriptStepSchema = z.object({
  type: z.literal("script"),
  command: z.string().min(1),
  args: z.array(z.string()).default([]),
  timeout: timeoutSchema,
  path: z.string().optional(),
  continueOnError: z.boolean().optional(),
  retry: z.number().int().min(0).optional(),
});

const quitIdleStepSchema = z.object({
  type: z.literal("quit-idle"),
  processNames: z.array(z.string().min(1)).min(1),
  idleFor: timeoutSchema,
  countIdleFrom: hhmm.default("00:00"),
  until: hhmm.default("08:00"),
  timeout: timeoutSchema,
  continueOnError: z.boolean().optional(),
  retry: z.number().int().min(0).optional(),
});

const stepSchema = z.discriminatedUnion("type", [
  toolsetStepSchema,
  svnStepSchema,
  unityStepSchema,
  scriptStepSchema,
  quitIdleStepSchema,
]);

const workspaceSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  path: z.string().min(1),
  oncePerDay: z.boolean().default(true),
  steps: z.array(stepSchema).min(1),
});

const scheduleSchema = z.object({
  id: z.string().min(1),
  description: z.string().optional(),
  cron: z.string().min(1),
  workspaceIds: z.array(z.string().min(1)).min(1),
});

export const configSchema = z.object({
  version: z.literal(1),
  timezone: z.string().min(1),
  runtime: z.object({
    maxConcurrentRuns: z.number().int().min(1).default(1),
    catchUpPreviousDays: z.number().int().min(0).default(0),
    retryFailedOnCatchUp: z.boolean().default(false),
    releaseOccupants: z.boolean().default(true),
    releaseGraceMs: z.number().int().min(0).default(20_000),
  }),
  schedules: z.array(scheduleSchema).min(1),
  workspaces: z.array(workspaceSchema).min(1),
  reporting: z
    .object({
      enabled: z.boolean(),
      adapter: z.string().optional(),
      endpointEnv: z.string().optional(),
      on: z.array(z.string()).default([]),
    })
    .default({ enabled: false, on: [] }),
  brain: z
    .object({
      enabled: z.boolean(),
      provider: z.string().optional(),
      model: z.string().optional(),
      maxTurns: z.number().int().positive().optional(),
      permissionMode: z.string().optional(),
      allowedTools: z.array(z.string()).default([]),
      allowedCommands: z.array(z.string()).default([]),
      requireConfirmationFor: z.array(z.string()).default([]),
    })
    .default({ enabled: false, allowedTools: [], allowedCommands: [], requireConfirmationFor: [] }),
});

export type AppConfig = z.infer<typeof configSchema>;
export type Workspace = AppConfig["workspaces"][number];
export type Step = Workspace["steps"][number];
export type NormalizedStep = ToolInvocation;

export function defaultConfigCandidates(dataDir = defaultDataDir()): string[] {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const repoRoot = path.resolve(here, "..", "..", "..", "..");
  return [
    configPathIn(dataDir),
    path.join(homedir(), "AppData", "Roaming", "workspace-orchestrator", "config.yaml"),
    path.join(repoRoot, "plans", "workspace-orchestrator", "config.example.yaml"),
  ];
}

export function toInvocation(step: Step): ToolInvocation {
  return normalizeStep(step as unknown as Record<string, unknown>);
}

export function stepWorkingPath(workspace: Workspace, step: Step | ToolInvocation): string {
  const sub =
    "path" in step && typeof step.path === "string"
      ? step.path
      : "params" in step && typeof step.params?.path === "string"
        ? (step.params.path as string)
        : undefined;
  if (!sub) {
    return workspace.path;
  }
  return path.resolve(workspace.path, sub);
}

export function readConfigText(filePath: string): string {
  return readFileSync(filePath, "utf8").replace(/^\uFEFF+/g, "");
}

export function parseConfigFromText(
  raw: string,
  filePath: string,
  dataDir = defaultDataDir(),
  options: { resolvePaths?: boolean } = {},
): AppConfig {
  const parsed = parseYaml(raw);
  const result = configSchema.safeParse(parsed);
  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `  - ${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("\n");
    throw new Error(`配置校验失败: ${filePath}\n${details}`);
  }

  const config = result.data;
  if (options.resolvePaths !== false) {
    const configDir = path.dirname(path.resolve(filePath));
    for (const workspace of config.workspaces) {
      workspace.path = path.resolve(configDir, workspace.path);
    }
  }

  const workspaceIds = new Set(config.workspaces.map((w) => w.id));
  if (workspaceIds.size !== config.workspaces.length) {
    throw new Error("workspaces[].id 不能重复");
  }

  const scheduleIds = new Set(config.schedules.map((s) => s.id));
  if (scheduleIds.size !== config.schedules.length) {
    throw new Error("schedules[].id 不能重复");
  }

  for (const schedule of config.schedules) {
    for (const id of schedule.workspaceIds) {
      if (!workspaceIds.has(id)) {
        throw new Error(`schedule ${schedule.id} 引用了不存在的 workspace: ${id}`);
      }
    }
  }

  const toolErrors: string[] = [];
  for (const workspace of config.workspaces) {
    workspace.steps.forEach((step, index) => {
      const inv = toInvocation(step);
      const errors = validateInvocationParams(inv, (ts, tool) => resolveTool(ts, tool, dataDir));
      for (const err of errors) {
        toolErrors.push(`  - workspaces.${workspace.id}.steps[${index}]: ${err}`);
      }
      if (inv.toolsetId !== "builtin" && !resolveTool(inv.toolsetId, inv.tool, dataDir)) {
        toolErrors.push(
          `  - workspaces.${workspace.id}.steps[${index}]: toolset ${inv.toolsetId} 未安装或缺少工具 ${inv.tool}`,
        );
      }
    });
  }
  if (toolErrors.length > 0) {
    throw new Error(`工具参数校验失败: ${filePath}\n${toolErrors.join("\n")}`);
  }

  return config;
}

export function loadConfig(filePath: string, dataDir = defaultDataDir()): AppConfig {
  return parseConfigFromText(readConfigText(filePath), filePath, dataDir);
}

export function mkdirp(dir: string): void {
  mkdirSync(dir, { recursive: true });
}

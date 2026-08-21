import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import { configPathIn, defaultDataDir, legacyDataDir } from "./paths";
import {
  normalizeStep,
  resolveTool,
  type ToolInvocation,
  validateInvocationParams,
} from "./toolset";
import { migrateV1toV2, type MigrationResult } from "./config-migrate";

const timeoutSchema = z
  .string()
  .regex(/^\d+(ms|s|m|h)$/, "timeout 形如 90m / 2h / 15s");

const hhmm = z.string().regex(/^\d{2}:\d{2}$/, "时间形如 00:00");

/** Unified toolset step (v1 disk + still accepted on load). */
export const toolsetStepSchema = z.object({
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

/** v2 canonical step: uses: toolset/tool */
export const usesStepSchema = z.object({
  uses: z.string().min(1).regex(/^[^/]+\/.+$/, "uses 形如 builtin/svn-update"),
  with: z.record(z.string(), z.unknown()).default({}),
  args: z.array(z.string()).optional(),
  path: z.string().optional(),
  timeout: timeoutSchema,
  retry: z.number().int().min(0).optional(),
  continueOnError: z.boolean().optional(),
});

export const stepSchema = z.union([
  usesStepSchema,
  toolsetStepSchema,
  svnStepSchema,
  unityStepSchema,
  scriptStepSchema,
  quitIdleStepSchema,
]);

const runtimeSchema = z.object({
  maxConcurrentRuns: z.number().int().min(1).default(1),
  catchUpPreviousDays: z.number().int().min(0).default(0),
  retryFailedOnCatchUp: z.boolean().default(false),
  releaseOccupants: z.boolean().default(true),
  releaseGraceMs: z.number().int().min(0).default(20_000),
});

const reportingSchema = z
  .object({
    enabled: z.boolean(),
    adapter: z.string().optional(),
    endpointEnv: z.string().optional(),
    on: z.array(z.string()).default([]),
  })
  .default({ enabled: false, on: [] });

const brainSchema = z
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
  .default({
    enabled: false,
    allowedTools: [],
    allowedCommands: [],
    requireConfirmationFor: [],
  });

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

/** v1 disk format — still accepted on load, then migrated in memory. */
export const configV1Schema = z.object({
  version: z.literal(1),
  timezone: z.string().min(1),
  runtime: runtimeSchema,
  schedules: z.array(scheduleSchema).min(1),
  workspaces: z.array(workspaceSchema).min(1),
  reporting: reportingSchema,
  brain: brainSchema,
});

const triggerSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("cron"),
    cron: z.string().min(1),
  }),
  z.object({
    type: z.literal("manual"),
  }),
]);

export const targetSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  path: z.string().min(1),
  oncePerDay: z.boolean().default(true),
  steps: z.array(stepSchema).min(1),
});

export const taskSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  enabled: z.boolean().default(true),
  trigger: triggerSchema,
  targets: z.array(targetSchema).min(1),
});

export const configV2Schema = z.object({
  version: z.literal(2),
  timezone: z.string().min(1),
  runtime: runtimeSchema,
  tasks: z.array(taskSchema).min(1),
  reporting: reportingSchema,
  brain: brainSchema,
});

export type AppConfigV1 = z.infer<typeof configV1Schema>;
export type AppConfig = z.infer<typeof configV2Schema>;
export type Task = AppConfig["tasks"][number];
export type Target = Task["targets"][number];
/** @deprecated alias — a runnable unit is now Target */
export type Workspace = Target;
export type Step = Target["steps"][number];
export type NormalizedStep = ToolInvocation;

export type ConfigIssue = {
  path: string;
  level: "error" | "warning";
  message: string;
};

export type ParseConfigResult = {
  config: AppConfig;
  migratedFromV1: boolean;
  migrationWarnings: string[];
  revision: string;
};

export function defaultConfigCandidates(dataDir = defaultDataDir()): string[] {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const repoRoot = path.resolve(here, "..", "..", "..", "..");
  return [
    configPathIn(dataDir),
    path.join(legacyDataDir(), "config.yaml"),
    path.join(repoRoot, "plans", "workspace-orchestrator", "config.example.yaml"),
  ];
}

export function contentRevision(text: string, filePath?: string): string {
  const hash = createHash("sha256").update(text).digest("hex").slice(0, 16);
  if (!filePath) {
    return hash;
  }
  try {
    const mtime = Math.floor(statSync(filePath).mtimeMs);
    return `${hash}:${mtime}`;
  } catch {
    return hash;
  }
}

export function toInvocation(step: Step | Record<string, unknown>): ToolInvocation {
  const raw = step as Record<string, unknown>;
  if (typeof raw.uses === "string") {
    const slash = raw.uses.indexOf("/");
    const toolsetId = slash >= 0 ? raw.uses.slice(0, slash) : "builtin";
    const tool = slash >= 0 ? raw.uses.slice(slash + 1) : String(raw.uses);
    return {
      toolsetId,
      tool,
      params: (raw.with as Record<string, unknown>) ?? {},
      rawArgs: Array.isArray(raw.args) ? (raw.args as string[]) : undefined,
      path: typeof raw.path === "string" ? raw.path : undefined,
      timeout: String(raw.timeout ?? "30m"),
      retry: typeof raw.retry === "number" ? raw.retry : undefined,
      continueOnError: raw.continueOnError === true,
    };
  }
  return normalizeStep(raw);
}

export function stepWorkingPath(target: Target, step: Step | ToolInvocation): string {
  const sub =
    "path" in step && typeof step.path === "string"
      ? step.path
      : "params" in step && typeof step.params?.path === "string"
        ? (step.params.path as string)
        : undefined;
  if (!sub) {
    return target.path;
  }
  return path.resolve(target.path, sub);
}

export function readConfigText(filePath: string): string {
  return readFileSync(filePath, "utf8").replace(/^\uFEFF+/g, "");
}

export function findTarget(
  config: AppConfig,
  targetId: string,
): { task: Task; target: Target } | undefined {
  for (const task of config.tasks) {
    const target = task.targets.find((item) => item.id === targetId);
    if (target) {
      return { task, target };
    }
  }
  return undefined;
}

export function listTargets(config: AppConfig): Array<{ task: Task; target: Target }> {
  const out: Array<{ task: Task; target: Target }> = [];
  for (const task of config.tasks) {
    for (const target of task.targets) {
      out.push({ task, target });
    }
  }
  return out;
}

function validateV2Semantics(
  config: AppConfig,
  filePath: string,
  dataDir: string,
): ConfigIssue[] {
  const issues: ConfigIssue[] = [];
  const taskIds = new Set<string>();
  const targetIds = new Set<string>();

  for (const task of config.tasks) {
    if (taskIds.has(task.id)) {
      issues.push({ path: `tasks.${task.id}`, level: "error", message: "tasks[].id 不能重复" });
    }
    taskIds.add(task.id);
    if (task.trigger.type === "cron" && !task.trigger.cron.trim()) {
      issues.push({
        path: `tasks.${task.id}.trigger.cron`,
        level: "error",
        message: "cron 触发器需要表达式",
      });
    }
    for (const target of task.targets) {
      if (targetIds.has(target.id)) {
        issues.push({
          path: `tasks.${task.id}.targets.${target.id}`,
          level: "error",
          message: `target id 全局不能重复: ${target.id}`,
        });
      }
      targetIds.add(target.id);
      target.steps.forEach((step, index) => {
        const inv = toInvocation(step);
        const errors = validateInvocationParams(inv, (ts, tool) => resolveTool(ts, tool, dataDir));
        for (const err of errors) {
          issues.push({
            path: `tasks.${task.id}.targets.${target.id}.steps[${index}]`,
            level: "error",
            message: err,
          });
        }
        if (inv.toolsetId !== "builtin" && !resolveTool(inv.toolsetId, inv.tool, dataDir)) {
          issues.push({
            path: `tasks.${task.id}.targets.${target.id}.steps[${index}]`,
            level: "error",
            message: `toolset ${inv.toolsetId} 未安装或缺少工具 ${inv.tool}`,
          });
        }
      });
    }
  }

  if (issues.some((item) => item.level === "error")) {
    const details = issues
      .filter((item) => item.level === "error")
      .map((item) => `  - ${item.path}: ${item.message}`)
      .join("\n");
    throw new Error(`配置校验失败: ${filePath}\n${details}`);
  }
  return issues;
}

function resolveTargetPaths(config: AppConfig, filePath: string): void {
  const configDir = path.dirname(path.resolve(filePath));
  for (const task of config.tasks) {
    for (const target of task.targets) {
      target.path = path.resolve(configDir, target.path);
    }
  }
}

export function parseConfigFromText(
  raw: string,
  filePath: string,
  dataDir = defaultDataDir(),
  options: { resolvePaths?: boolean } = {},
): AppConfig {
  return parseConfigDetailed(raw, filePath, dataDir, options).config;
}

export function parseConfigDetailed(
  raw: string,
  filePath: string,
  dataDir = defaultDataDir(),
  options: { resolvePaths?: boolean } = {},
): ParseConfigResult {
  const parsed = parseYaml(raw);
  if (!parsed || typeof parsed !== "object") {
    throw new Error(`配置校验失败: ${filePath}\n  - (root): 需要 YAML 对象`);
  }

  const version = (parsed as { version?: unknown }).version;
  let config: AppConfig;
  let migratedFromV1 = false;
  let migrationWarnings: string[] = [];

  if (version === 2) {
    const result = configV2Schema.safeParse(parsed);
    if (!result.success) {
      const details = result.error.issues
        .map((issue) => `  - ${issue.path.join(".") || "(root)"}: ${issue.message}`)
        .join("\n");
      throw new Error(`配置校验失败: ${filePath}\n${details}`);
    }
    config = result.data;
  } else if (version === 1) {
    const result = configV1Schema.safeParse(parsed);
    if (!result.success) {
      const details = result.error.issues
        .map((issue) => `  - ${issue.path.join(".") || "(root)"}: ${issue.message}`)
        .join("\n");
      throw new Error(`配置校验失败: ${filePath}\n${details}`);
    }
    const migrated: MigrationResult = migrateV1toV2(result.data);
    config = migrated.config;
    migratedFromV1 = true;
    migrationWarnings = migrated.warnings;
  } else {
    throw new Error(`配置校验失败: ${filePath}\n  - version: 仅支持 1 或 2，收到 ${String(version)}`);
  }

  if (options.resolvePaths !== false) {
    resolveTargetPaths(config, filePath);
  }

  validateV2Semantics(config, filePath, dataDir);

  return {
    config,
    migratedFromV1,
    migrationWarnings,
    revision: contentRevision(raw, filePath),
  };
}

export function loadConfig(filePath: string, dataDir = defaultDataDir()): AppConfig {
  return parseConfigFromText(readConfigText(filePath), filePath, dataDir);
}

export function mkdirp(dir: string): void {
  mkdirSync(dir, { recursive: true });
}

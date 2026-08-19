import { mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import { configPathIn, defaultDataDir } from "./paths";

const timeoutSchema = z
  .string()
  .regex(/^\d+(ms|s|m|h)$/, "timeout 形如 90m / 2h / 15s");

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

const stepSchema = z.discriminatedUnion("type", [
  svnStepSchema,
  unityStepSchema,
  scriptStepSchema,
]);

const workspaceSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  path: z.string().min(1),
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

export function defaultConfigCandidates(dataDir = defaultDataDir()): string[] {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const repoRoot = path.resolve(here, "..", "..", "..", "..");
  return [
    configPathIn(dataDir),
    path.join(homedir(), "AppData", "Roaming", "workspace-orchestrator", "config.yaml"),
    path.join(repoRoot, "plans", "workspace-orchestrator", "config.example.yaml"),
  ];
}

export function stepWorkingPath(workspace: Workspace, step: Step): string {
  if (!step.path) {
    return workspace.path;
  }
  return path.resolve(workspace.path, step.path);
}

export function loadConfig(filePath: string): AppConfig {
  const raw = readFileSync(filePath, "utf8").replace(/^\uFEFF+/g, "");
  const parsed = parseYaml(raw);
  const result = configSchema.safeParse(parsed);
  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `  - ${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("\n");
    throw new Error(`配置校验失败: ${filePath}\n${details}`);
  }

  const config = result.data;
  const configDir = path.dirname(path.resolve(filePath));
  for (const workspace of config.workspaces) {
    workspace.path = path.resolve(configDir, workspace.path);
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

  return config;
}

export function mkdirp(dir: string): void {
  mkdirSync(dir, { recursive: true });
}

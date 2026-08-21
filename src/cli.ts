import { existsSync } from "node:fs";
import path from "node:path";
import { ensureUserConfig } from "./core/bootstrap";
import { listTargets, loadConfig } from "./core/config";
import { Orchestrator } from "./core/orchestrator";
import { defaultDataDir } from "./core/paths";
import { buildPlan } from "./core/plan";
import { displayTime } from "./core/time";

type Args = {
  command: "validate" | "status" | "run" | "catch-up" | "help";
  config?: string;
  workspace?: string;
  task?: string;
  dryRun: boolean;
};

function parseArgs(argv: string[]): Args {
  const args: Args = { command: "help", dryRun: false };
  const rest = [...argv];
  const command = rest.shift();
  if (
    command === "validate" ||
    command === "status" ||
    command === "run" ||
    command === "catch-up" ||
    command === "help"
  ) {
    args.command = command;
  } else if (command) {
    throw new Error(`未知命令: ${command}`);
  }

  while (rest.length > 0) {
    const token = rest.shift()!;
    if (token === "--config" || token === "-c") {
      args.config = rest.shift();
      continue;
    }
    if (token === "--workspace" || token === "-w" || token === "--target") {
      args.workspace = rest.shift();
      continue;
    }
    if (token === "--task" || token === "-t") {
      args.task = rest.shift();
      continue;
    }
    if (token === "--dry-run") {
      args.dryRun = true;
      continue;
    }
    throw new Error(`未知参数: ${token}`);
  }
  return args;
}

function resolvePaths(explicit?: string): { configPath: string; dataDir: string } {
  if (explicit) {
    if (!existsSync(explicit)) {
      throw new Error(`找不到配置文件: ${explicit}`);
    }
    const configPath = path.resolve(explicit);
    return { configPath, dataDir: path.join(path.dirname(configPath), ".orch-state") };
  }
  const dataDir = defaultDataDir();
  return { configPath: ensureUserConfig(dataDir), dataDir };
}

function printHelp(): void {
  console.log(`工作目录编排器

用法:
  npm start
  npm run cli -- validate [--config <yaml>]
  npm run cli -- status [--config <yaml>]
  npm run cli -- run --target <id> [--dry-run] [--config <yaml>]
  npm run cli -- run --workspace <id>   # target 别名
  npm run cli -- run --task <id> [--config <yaml>]
  npm run cli -- catch-up [--config <yaml>]

默认配置: %APPDATA%/cronkit/config.yaml`);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.command === "help") {
    printHelp();
    return;
  }

  const { configPath, dataDir } = resolvePaths(args.config);
  const config = loadConfig(configPath, dataDir);

  if (args.command === "validate") {
    const targets = listTargets(config);
    console.log(`配置有效: ${configPath}`);
    console.log(
      `时区 ${config.timezone}  ·  ${config.tasks.length} 个任务  ·  ${targets.length} 个目标`,
    );
    return;
  }

  if (args.command === "status") {
    console.log(`配置: ${configPath}`);
    for (const item of buildPlan(config)) {
      const when = item.autoScheduled
        ? `下次 ${item.nextRun ? displayTime(item.nextRun, config.timezone) : "(cron 无效)"}`
        : "仅手动";
      console.log(`\n[${item.workspaceId}] ${item.workspaceName}`);
      console.log(`  任务    ${item.taskId}  ${item.taskName}`);
      console.log(`  路径    ${item.path}`);
      console.log(`  调度    ${item.cron}  ${when}`);
      for (const step of item.steps) {
        console.log(`  步骤    ${step}`);
      }
    }
    return;
  }

  const orch = new Orchestrator({ configPath, dataDir });

  if (args.command === "catch-up") {
    orch.setSchedulerEnabled(true);
    orch.catchUpNow();
    await waitIdle(orch);
    printRuns(orch);
    return;
  }

  if (args.task) {
    if (args.dryRun) {
      throw new Error("整 task dry-run 请对每个 --target 分别执行");
    }
    const runs = await orch.runTask(args.task, "manual");
    for (const run of runs) {
      console.log(`${run.status}  ${run.workspaceId}  ${run.runId}`);
    }
    if (runs.some((run) => run.status === "failed" || run.status === "cancelled")) {
      process.exitCode = 1;
    }
    return;
  }

  if (!args.workspace) {
    throw new Error("run 需要 --target <id>（或 --workspace / --task）");
  }

  if (args.dryRun) {
    const { dryRunTarget } = await import("./core/probe");
    const { workspace, probes } = dryRunTarget(config, args.workspace);
    console.log(`dry-run ${workspace.id}  ${workspace.name}`);
    let failed = 0;
    for (const probe of probes) {
      if (!probe.ok) {
        failed += 1;
      }
      console.log(`  [${probe.ok ? "OK" : "FAIL"}] ${probe.summary}`);
      console.log(`        ${probe.detail}`);
    }
    if (failed > 0) {
      process.exitCode = 1;
    }
    return;
  }

  const run = await orch.runTarget(args.workspace, "manual");
  console.log(`${run.status}  ${run.workspaceId}  ${run.runId}`);
  for (const step of run.steps) {
    console.log(`  [${step.status}] ${step.summary}${step.error ? `  ${step.error}` : ""}`);
  }
  if (run.status === "failed" || run.status === "cancelled") {
    process.exitCode = 1;
  }
}

function waitIdle(orch: Orchestrator): Promise<void> {
  return new Promise((resolve) => {
    const check = (): void => {
      const snap = orch.snapshot();
      if (snap.appState !== "running") {
        resolve();
        return;
      }
      setTimeout(check, 500);
    };
    check();
  });
}

function printRuns(orch: Orchestrator): void {
  for (const run of orch.snapshot().runs.slice(0, 10)) {
    console.log(`${run.localDate} ${run.workspaceId} ${run.trigger} ${run.status}`);
  }
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}

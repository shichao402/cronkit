import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { configPathIn, legacyDataDir } from "./paths";

type Detected = {
  id: string;
  name: string;
  root: string;
  strategy: "follow-latest" | "manual";
  hasUnity: boolean;
};

function detectWorkspaces(): Detected[] {
  const seeds: Omit<Detected, "hasUnity">[] = [
    { id: "osg-trunk1", name: "OSG 主干 1", root: "D:/workspace/OSG_Trunk1", strategy: "follow-latest" },
    { id: "osg-trunk2", name: "OSG 主干 2", root: "D:/workspace/OSG_Trunk2", strategy: "follow-latest" },
    { id: "osg-branch1", name: "OSG 分支 1", root: "D:/workspace/OSG_Branch1", strategy: "manual" },
    { id: "osg-branch2", name: "OSG 分支 2", root: "D:/workspace/OSG_Branch2", strategy: "manual" },
  ];
  const found: Detected[] = [];
  for (const seed of seeds) {
    if (!existsSync(seed.root) || !existsSync(`${seed.root}/.svn`)) {
      continue;
    }
    found.push({
      ...seed,
      hasUnity: existsSync(`${seed.root}/Project/ProjectSettings/ProjectVersion.txt`),
    });
  }
  return found;
}

function renderTarget(item: Detected, indent = "      "): string {
  const unity = item.hasUnity
    ? `
${indent}  - uses: builtin/unity-warmup
${indent}    path: Project
${indent}    with:
${indent}      nographics: false
${indent}    timeout: 90m
${indent}    retry: 1`
    : "";
  return `${indent}- id: ${item.id}
${indent}  name: ${item.name}
${indent}  path: "${item.root}"
${indent}  steps:
${indent}  - uses: builtin/svn-update
${indent}    with:
${indent}      strategy: ${item.strategy}
${indent}    timeout: 2h
${indent}    retry: 1${unity}`;
}

function renderConfig(detected: Detected[]): string {
  const auto = detected.filter((item) => item.strategy === "follow-latest");
  const manual = detected.filter((item) => item.strategy === "manual");
  const scheduled = auto.length > 0 ? auto : detected;

  const cronTask =
    scheduled.length > 0
      ? `  - id: after-midnight
    name: 每天凌晨后的例行更新与预热
    trigger:
      type: cron
      cron: "10 2 * * *"
    targets:
${scheduled.map((item) => renderTarget(item)).join("\n")}`
      : "";

  const manualTasks = manual
    .filter((item) => auto.length === 0 || item.strategy === "manual")
    .map(
      (item) => `  - id: manual-${item.id}
    name: ${item.name}
    trigger:
      type: manual
    targets:
${renderTarget(item)}`,
    )
    .join("\n\n");

  // When auto list is empty we already put everyone in cronTask; skip duplicate manuals.
  const extraManual =
    auto.length > 0
      ? manual
          .map(
            (item) => `  - id: manual-${item.id}
    name: ${item.name}
    trigger:
      type: manual
    targets:
${renderTarget(item)}`,
          )
          .join("\n\n")
      : "";

  const tasksBlock = [cronTask, extraManual || (auto.length === 0 ? "" : manualTasks)]
    .filter(Boolean)
    .join("\n\n");

  return `# 工作目录编排器
# 本文件由首次启动根据本机目录生成，请先核对路径和策略再「启用自动调度」。
# 不要写入口令或 token。

version: 2
timezone: Asia/Shanghai

runtime:
  maxConcurrentRuns: 1
  catchUpPreviousDays: 0
  retryFailedOnCatchUp: false

tasks:
${tasksBlock}

reporting:
  enabled: false
  adapter: wechat-bot
  endpointEnv: WECHAT_BOT_ENDPOINT
  on:
    - run-finished
    - daily-summary

brain:
  enabled: false
  provider: codebuddy
  model: claude-4.5
  maxTurns: 8
  permissionMode: default
  allowedTools:
    - Read
    - Grep
    - Glob
  allowedCommands:
    - runWorkspace
    - runTarget
    - cancelRun
    - summarizeDay
  requireConfirmationFor:
    - runWorkspace
    - runTarget
    - cancelRun
`;
}

const FALLBACK = `# 工作目录编排器
# 请把 path 改成本机 SVN / Unity 目录后再启用自动调度。

version: 2
timezone: Asia/Shanghai

runtime:
  maxConcurrentRuns: 1
  catchUpPreviousDays: 0
  retryFailedOnCatchUp: false

tasks:
  - id: after-midnight
    name: 每天凌晨后的例行更新与预热
    trigger:
      type: cron
      cron: "10 2 * * *"
    targets:
      - id: example-project
        name: 示例项目
        path: "D:/path/to/svn-workspace"
        steps:
          - uses: builtin/svn-update
            with:
              strategy: follow-latest
            timeout: 2h
          - uses: builtin/unity-warmup
            path: Project
            with:
              nographics: false
            timeout: 90m
            retry: 1

reporting:
  enabled: false
  on: []

brain:
  enabled: false
`;

const MIGRATE_ENTRIES = ["config.yaml", "state.json", "toolsets-state.json", "logs", "toolsets"];

function rewriteLegacyDataPaths(text: string, fromDir: string, toDir: string): string {
  const toFwd = toDir.replace(/\\/g, "/");
  const froms = [fromDir, fromDir.replace(/\\/g, "/"), fromDir.replace(/\//g, "\\")];
  let out = text;
  for (const from of froms) {
    if (from) {
      out = out.split(from).join(toFwd);
    }
  }
  return out;
}

/** 若新目录还没有配置、旧 AppData 有，则拷贝用户数据（不搬 Electron 缓存）。 */
export function migrateLegacyUserData(dataDir: string): void {
  const destConfig = configPathIn(dataDir);
  if (existsSync(destConfig)) {
    return;
  }
  const legacy = legacyDataDir();
  const srcConfig = configPathIn(legacy);
  if (!existsSync(srcConfig) || path.resolve(legacy) === path.resolve(dataDir)) {
    return;
  }
  mkdirSync(dataDir, { recursive: true });
  for (const name of MIGRATE_ENTRIES) {
    const from = path.join(legacy, name);
    if (!existsSync(from)) {
      continue;
    }
    cpSync(from, path.join(dataDir, name), { recursive: true });
  }
  if (existsSync(destConfig)) {
    const rewritten = rewriteLegacyDataPaths(readFileSync(destConfig, "utf8"), legacy, dataDir);
    writeFileSync(destConfig, rewritten, "utf8");
  }
}

export function ensureUserConfig(dataDir: string): string {
  migrateLegacyUserData(dataDir);
  mkdirSync(dataDir, { recursive: true });
  const dest = configPathIn(dataDir);
  if (existsSync(dest)) {
    return dest;
  }
  const detected = detectWorkspaces();
  writeFileSync(dest, detected.length > 0 ? renderConfig(detected) : FALLBACK, "utf8");
  return dest;
}

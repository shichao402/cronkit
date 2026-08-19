import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { configPathIn } from "./paths";

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

function renderConfig(detected: Detected[]): string {
  const autoIds = detected.filter((item) => item.strategy === "follow-latest").map((item) => item.id);
  const scheduled = autoIds.length > 0 ? autoIds : detected.map((item) => item.id);
  const workspaces = detected.map((item) => {
    const unity = item.hasUnity
      ? `
      - type: unity-warmup
        path: Project
        timeout: 90m
        nographics: false`
      : "";
    return `  - id: ${item.id}
    name: ${item.name}
    path: "${item.root}"
    steps:
      - type: svn-update
        strategy: ${item.strategy}
        timeout: 2h
        retry: 1${unity}`;
  });

  return `# 工作目录编排器
# 本文件由首次启动根据本机目录生成，请先核对路径和策略再「启用自动调度」。
# 不要写入口令或 token。

version: 1
timezone: Asia/Shanghai

runtime:
  maxConcurrentRuns: 1
  catchUpPreviousDays: 0
  retryFailedOnCatchUp: false

schedules:
  - id: after-midnight
    description: 每天凌晨后的例行更新与预热
    cron: "10 2 * * *"
    workspaceIds:
${scheduled.map((id) => `      - ${id}`).join("\n")}

workspaces:
${workspaces.join("\n\n")}

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
    - cancelRun
    - summarizeDay
  requireConfirmationFor:
    - runWorkspace
    - cancelRun
`;
}

const FALLBACK = `# 工作目录编排器
# 请把 path 改成本机 SVN / Unity 目录后再启用自动调度。

version: 1
timezone: Asia/Shanghai

runtime:
  maxConcurrentRuns: 1
  catchUpPreviousDays: 0
  retryFailedOnCatchUp: false

schedules:
  - id: after-midnight
    description: 每天凌晨后的例行更新与预热
    cron: "10 2 * * *"
    workspaceIds:
      - example-project

workspaces:
  - id: example-project
    name: 示例项目
    path: "D:/path/to/svn-workspace"
    steps:
      - type: svn-update
        strategy: follow-latest
        timeout: 2h
      - type: unity-warmup
        path: Project
        timeout: 90m
        nographics: false

reporting:
  enabled: false
  on: []

brain:
  enabled: false
`;

export function ensureUserConfig(dataDir: string): string {
  mkdirSync(dataDir, { recursive: true });
  const dest = configPathIn(dataDir);
  if (existsSync(dest)) {
    return dest;
  }
  const detected = detectWorkspaces();
  writeFileSync(dest, detected.length > 0 ? renderConfig(detected) : FALLBACK, "utf8");
  return dest;
}

import type { DesktopApi } from "../../src/renderer/global";
import type { UpdateStatus, UpdateTargetInfo } from "../../src/core/update/status";
import type {
  ConfigEditorPayload,
  EditorDraft,
  SaveConfigResult,
  Snapshot,
  ThemePref,
} from "../../src/shared/types";
import { draftToYaml } from "../../src/shared/draft-yaml";

const now = Date.now();
const iso = (offsetMs: number): string => new Date(now + offsetMs).toISOString();
const day = new Date(now).toISOString().slice(0, 10);
const light = new URLSearchParams(location.search).get("theme") === "light";
const scenario = new URLSearchParams(location.search).get("scenario") ?? "ok";

const snapshot: Snapshot = {
  configPath: "C:/Users/firoyang/AppData/Roaming/cronkit/config.yaml",
  dataDir: "C:/Users/firoyang/AppData/Roaming/cronkit",
  timezone: "Asia/Shanghai",
  appState: "running",
  schedulerEnabled: true,
  openAtLogin: true,
  theme: light ? "light" : "dark",
  resolvedTheme: light ? "light" : "dark",
  exitWarnsRunning: true,
  toolsets: [
    {
      id: "builtin",
      displayName: "内置工具集",
      root: "(in-process)",
      schemaVersion: 1,
      installed: true,
      depsReady: true,
      tools: [
        {
          id: "svn-update",
          displayName: "SVN 更新",
          params: [
            {
              name: "strategy",
              type: "enum",
              enum: ["follow-latest", "manual", "disabled"],
              required: true,
              default: "follow-latest",
            },
            { name: "onConflict", type: "enum", enum: ["fail", "revert"], default: "fail" },
          ],
        },
        {
          id: "unity-warmup",
          displayName: "Unity 预热",
          params: [{ name: "nographics", type: "boolean", default: false }],
        },
        {
          id: "script",
          displayName: "自定义脚本",
          params: [
            { name: "command", type: "string", required: true },
            { name: "args", type: "string[]", default: [] },
          ],
        },
        {
          id: "quit-idle",
          displayName: "空闲退出进程",
          params: [
            { name: "processNames", type: "string[]", required: true },
            { name: "idleFor", type: "string", required: true },
          ],
        },
      ],
    },
    {
      id: "osg",
      displayName: "OSGToolset",
      root: "C:/Users/firoyang/AppData/Roaming/cronkit/toolsets/osg",
      repo: "https://git.woa.com/firoyang/OSGToolset.git",
      schemaVersion: 1,
      sha: "8424b9b",
      installed: true,
      depsReady: true,
      tools: [
        { id: "env-check", displayName: "环境自检" },
        { id: "restore-generated", displayName: "还原可生成文件" },
        { id: "protobuf", displayName: "生成 Protobuf 代码" },
      ],
    },
  ],
  workspaces: [
    {
      id: "osg-branch-1",
      name: "OSG 分支 1",
      path: "D:/workspace/OSG_Branch1",
      autoScheduled: true,
      scheduleId: "nightly-0210",
      taskId: "nightly-0210",
      taskName: "夜间主更新",
      cron: "10 2 * * *",
      nextRun: iso(9 * 3600_000),
      running: true,
      steps: ["SVN 更新 (follow-latest) (timeout 2h)", "Unity 预热 (timeout 90m)"],
      lastRun: {
        runId: "run-1",
        workspaceId: "osg-branch-1",
        workspaceName: "OSG 分支 1",
        scheduleId: "nightly-0210",
        taskId: "nightly-0210",
        taskName: "夜间主更新",
        localDate: day,
        trigger: "manual",
        status: "running",
        startedAt: iso(-4 * 60_000),
        steps: [],
      },
    },
    {
      id: "osg-core-only",
      name: "OSGameCoreOnlyX",
      path: "D:/workspace/OSGameCoreOnlyX",
      autoScheduled: true,
      scheduleId: "nightly-0210",
      taskId: "nightly-0210",
      taskName: "夜间主更新",
      cron: "10 2 * * *",
      nextRun: iso(9 * 3600_000),
      running: false,
      steps: ["SVN 更新 (follow-latest) (timeout 2h)"],
      lastRun: {
        runId: "run-2",
        workspaceId: "osg-core-only",
        workspaceName: "OSGameCoreOnlyX",
        scheduleId: "nightly-0210",
        taskId: "nightly-0210",
        localDate: day,
        trigger: "schedule",
        status: "failed",
        startedAt: iso(-3 * 3600_000),
        finishedAt: iso(-3 * 3600_000 + 214_000),
        steps: [],
      },
    },
  ],
  runs: [],
};

const draft: EditorDraft = {
  version: 2,
  timezone: "Asia/Shanghai",
  runtime: {
    maxConcurrentRuns: 2,
    catchUpPreviousDays: 1,
    retryFailedOnCatchUp: true,
    releaseOccupants: true,
    releaseGraceMs: 20_000,
  },
  stepTemplates: [
    {
      id: "tpl-1",
      name: "OSG 分支：更新 + Unity 预热",
      vars: [{ name: "warmupTimeout", default: "90m" }],
      steps: [
        {
          toolsetId: "builtin",
          tool: "svn-update",
          timeout: "2h",
          retry: 1,
          params: { strategy: "follow-latest", onConflict: "fail" },
        },
        {
          toolsetId: "builtin",
          tool: "unity-warmup",
          timeout: "${warmupTimeout}",
          params: { nographics: false },
        },
      ],
    },
    {
      id: "tpl-2",
      name: "CoreOnly：仅 SVN 更新",
      vars: [],
      steps: [
        {
          toolsetId: "builtin",
          tool: "svn-update",
          timeout: "2h",
          params: { strategy: "follow-latest" },
        },
      ],
    },
  ],

  tasks: [

    {
      id: "nightly-0210",
      name: "夜间主更新",
      enabled: true,
      trigger: { type: "cron", cron: "10 2 * * *" },
      targets: [
        {
          id: "osg-branch-1",
          name: "OSG 分支 1",
          path: "D:/workspace/OSG_Branch1",
          oncePerDay: true,
          usesTemplate: "tpl-1",
          vars: { warmupTimeout: "90m" },
          steps: [],
        },
        {
          id: "osg-core-only",
          name: "OSGameCoreOnlyX",
          path: "D:/workspace/OSGameCoreOnlyX",
          oncePerDay: true,
          usesTemplate: "tpl-2",
          vars: {},
          steps: [],
        },

      ],
    },
  ],
  reporting: { enabled: false },
  brain: { enabled: false },
};

let revision = "mock-rev-1";
let diskText = draftToYaml(draft);

const editor: ConfigEditorPayload = {
  path: snapshot.configPath,
  text: diskText,
  revision,
  toolsets: snapshot.toolsets ?? [],
  draft: structuredClone(draft),
  migratedFromV1: scenario === "migrate",
  migrationWarnings:
    scenario === "migrate" ? ["workspace shared 被多个 schedule 引用，副本 id 为 shared@b"] : [],
  parseError: scenario === "broken" ? "配置校验失败: mock\n  - version: 仅支持 1 或 2" : undefined,
};

if (scenario === "broken") {
  delete editor.draft;
}

const ok = { ok: true as const };
const listeners = new Set<(next: Snapshot) => void>();

// 更新区块在预览里也要能看：默认展示「有新版本」，用 ?scenario=update-* 切换其余阶段。
const updateListeners = new Set<(next: UpdateStatus) => void>();

const updateTarget: UpdateTargetInfo = {
  version: "0.2.0+4",
  code: 4,
  mandatory: scenario === "update-mandatory",
  remainingHops: scenario === "update-chain" ? 2 : 1,
  isFinalHop: scenario !== "update-chain",
  releaseNotes:
    "- 新增更新检查与下载\n- 修复 Windows 上断点续传预分配失败\n- 托盘菜单可直接查看更新状态",
  releaseNotesUrl: "",
  sizeBytes: 96 * 1024 * 1024,
};

function initialUpdateStatus(): UpdateStatus {
  const base: UpdateStatus = {
    phase: "available",
    currentVersion: "0.1.0+1",
    enabled: true,
    lastCheckedAt: iso(-26 * 60_000),
    target: updateTarget,
  };
  switch (scenario) {
    case "update-current":
      return { phase: "current", currentVersion: "0.1.0+1", enabled: true, lastCheckedAt: iso(-8 * 60_000) };
    case "update-downloading":
      return {
        ...base,
        phase: "downloading",
        progress: {
          receivedBytes: Math.round(updateTarget.sizeBytes * 0.42),
          totalBytes: updateTarget.sizeBytes,
          bytesPerSecond: 3.1 * 1024 * 1024,
        },
      };
    case "update-ready":
      return {
        ...base,
        phase: "ready",
        downloadedPath: "C:/Users/firoyang/AppData/Roaming/cronkit/update-staging/cronkit-0.2.0-x64.zip",
      };
    case "update-applying":
      return {
        ...base,
        phase: "applying",
        downloadedPath: "C:/Users/firoyang/AppData/Roaming/cronkit/update-staging/cronkit-0.2.0-x64.zip",
      };
    case "update-failed":
      return {
        phase: "failed",
        currentVersion: "0.1.0+1",
        enabled: true,
        lastCheckedAt: iso(-2 * 60_000),
        message: "no usable index source",
        attempts: [
          "https://raw.firoyang.com/rup/directory/cronkit.pb: connect ETIMEDOUT",
          "service:cos-guangzhou: signature check failed (unknown key id)",
        ],
      };
    case "update-manual":
      return {
        phase: "manual",
        currentVersion: "0.1.0+1",
        enabled: true,
        lastCheckedAt: iso(-2 * 60_000),
        message: "这一版存在数据迁移缺陷，请前往下载页手动安装 0.2.1。",
        manualUrl: "https://raw.firoyang.com/rup/notice",
      };
    case "update-disabled":
      return { phase: "idle", currentVersion: "0.1.0+1", enabled: false };
    default:
      return base;
  }
}

let updateStatus = initialUpdateStatus();

function patchUpdate(next: Partial<UpdateStatus>): UpdateStatus {
  updateStatus = { ...updateStatus, ...next };
  for (const handler of updateListeners) {
    handler(structuredClone(updateStatus));
  }
  return structuredClone(updateStatus);
}


function emit(): void {
  const copy = structuredClone(snapshot);
  for (const handler of listeners) {
    handler(copy);
  }
}

function clone(): Snapshot {
  return structuredClone(snapshot);
}

function saveOk(nextText: string): SaveConfigResult {
  diskText = nextText;
  revision = `mock-rev-${Date.now()}`;
  editor.text = diskText;
  editor.revision = revision;
  editor.draft = structuredClone(draft);
  editor.parseError = undefined;
  return { ok: true, snapshot: clone(), revision };
}

export function installMockApi(): void {
  const api: DesktopApi = {
    getSnapshot: async () => clone(),
    runWorkspace: async () => clone(),
    runTarget: async () => clone(),
    runTask: async () => clone(),
    cancelRun: async () => undefined,
    catchUp: async () => clone(),
    reloadConfig: async () => clone(),
    getConfigEditor: async () => {
      if (scenario === "empty") {
        return {
          path: snapshot.configPath,
          text: diskText,
          revision,
          toolsets: snapshot.toolsets ?? [],
          draft: {
            ...structuredClone(draft),
            tasks: [],
          },
        };
      }
      if (scenario === "conflict") {
        return { ...structuredClone(editor), revision: "stale-rev" };
      }
      return structuredClone(editor);
    },
    validateConfig: async (text) => {
      if (scenario === "validate-fail" || text.includes("INVALID")) {
        return { ok: false, error: "配置校验失败: mock\n  - tasks: 至少需要一个自动化任务" };
      }
      return ok;
    },
    previewConfig: async (text) => {
      if (text.includes("INVALID")) {
        return { ok: false, error: "YAML 无效" };
      }
      return { ok: true, draft: structuredClone(draft) };
    },
    saveConfigText: async (text, expectedRevision, force) => {
      if (!force && expectedRevision && expectedRevision !== revision) {
        return {
          ok: false,
          reason: "conflict",
          error: "磁盘配置已变更",
          diskRevision: revision,
          diskText,
        };
      }
      if (text.includes("INVALID")) {
        return {
          ok: false,
          reason: "validation",
          error: "配置无效",
          issues: [{ path: "tasks", level: "error", message: "至少需要一个自动化任务" }],
        };
      }
      return saveOk(text);
    },
    saveConfigDraft: async (nextDraft, expectedRevision, force) => {
      if (!force && expectedRevision && expectedRevision !== revision) {
        return {
          ok: false,
          reason: "conflict",
          error: "磁盘配置已变更",
          diskRevision: revision,
          diskText,
        };
      }
      Object.assign(draft, structuredClone(nextDraft));
      return saveOk(draftToYaml(nextDraft));
    },
    pickFolder: async () => "D:/workspace/picked",
    openConfig: async () => ok,
    openLogs: async () => ok,
    openDataDir: async () => ok,
    setOpenAtLogin: async (enabled) => {
      snapshot.openAtLogin = enabled;
      emit();
    },
    setSchedulerEnabled: async (enabled) => {
      snapshot.schedulerEnabled = enabled;
      emit();
    },
    setTheme: async (theme: ThemePref) => {
      snapshot.theme = theme;
      snapshot.resolvedTheme =
        theme === "system"
          ? matchMedia("(prefers-color-scheme: light)").matches
            ? "light"
            : "dark"
          : theme;
      emit();
    },
    setToolsetRepo: async (id, repo) => {
      const toolset = snapshot.toolsets?.find((item) => item.id === id);
      if (toolset) {
        toolset.repo = repo;
      }
      emit();
      return clone();
    },
    updateToolset: async () => clone(),
    getUpdateStatus: async () => structuredClone(updateStatus),
    checkForUpdate: async () => {
      patchUpdate({ phase: "checking", message: undefined, attempts: undefined });
      await new Promise((resolve) => setTimeout(resolve, 700));
      return patchUpdate({
        phase: "available",
        lastCheckedAt: new Date().toISOString(),
        target: updateTarget,
      });
    },
    downloadUpdate: async () => {
      const total = updateTarget.sizeBytes;
      patchUpdate({
        phase: "downloading",
        progress: { receivedBytes: 0, totalBytes: total, bytesPerSecond: 0 },
      });
      for (let step = 1; step <= 10; step += 1) {
        await new Promise((resolve) => setTimeout(resolve, 180));
        patchUpdate({
          phase: "downloading",
          progress: {
            receivedBytes: Math.round((total * step) / 10),
            totalBytes: total,
            bytesPerSecond: 3.4 * 1024 * 1024,
          },
        });
      }
      return patchUpdate({
        phase: "ready",
        downloadedPath:
          "C:/Users/firoyang/AppData/Roaming/cronkit/update-staging/cronkit-0.2.0-x64.zip",
      });
    },
    skipUpdate: async () =>
      patchUpdate({
        phase: "current",
        target: undefined,
        progress: undefined,
        downloadedPath: undefined,
        skipped: true,
      }),
    applyUpdate: async () => {
      patchUpdate({ phase: "applying" });
      return ok;
    },
    revealUpdate: async () => ok,
    openUpdateManualUrl: async () => ok,
    onUpdateStatus: (handler) => {
      updateListeners.add(handler);
      return () => updateListeners.delete(handler);
    },
    onSnapshot: (handler) => {
      listeners.add(handler);
      return () => listeners.delete(handler);
    },
  };
  window.api = api;
}

import type { DesktopApi } from "../../src/renderer/global";
import type { ConfigEditorPayload, Snapshot, ThemePref } from "../../src/shared/types";

const now = Date.now();
const iso = (offsetMs: number): string => new Date(now + offsetMs).toISOString();
const day = new Date(now).toISOString().slice(0, 10);
const light = new URLSearchParams(location.search).get("theme") === "light";

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
        { id: "svn-cleanup", displayName: "SVN 清理" },
        { id: "svn-update", displayName: "SVN 更新" },
        { id: "unity-warmup", displayName: "Unity 预热" },
        { id: "run-script", displayName: "运行脚本" },
        { id: "kill-process", displayName: "结束进程" },
      ],
    },
    {
      id: "osgtoolset",
      displayName: "OSGToolset",
      root: "C:/Users/firoyang/AppData/Roaming/cronkit/toolsets/osgtoolset",
      schemaVersion: 1,
      sha: "3f7a91c4d2b8",
      installed: true,
      depsReady: false,
      error: "缺少 Python 依赖 lxml",
      tools: [
        { id: "predowload", displayName: "预下载资源" },
        { id: "cpp-profiler", displayName: "C++ Profiler" },
        { id: "changelog", displayName: "生成变更日志" },
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
      cron: "10 2 * * *",
      nextRun: iso(9 * 3600_000),
      running: true,
      steps: ["svn-update (timeout 2h)", "unity-warmup (timeout 90m)"],
      lastRun: {
        runId: "run-1",
        workspaceId: "osg-branch-1",
        workspaceName: "OSG 分支 1",
        scheduleId: "manual",
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
      cron: "10 2 * * *",
      nextRun: iso(9 * 3600_000),
      running: false,
      steps: ["svn-update (timeout 2h)"],
      lastRun: {
        runId: "run-2",
        workspaceId: "osg-core-only",
        workspaceName: "OSGameCoreOnlyX",
        scheduleId: "nightly-0210",
        localDate: day,
        trigger: "schedule",
        status: "failed",
        startedAt: iso(-3 * 3600_000),
        finishedAt: iso(-3 * 3600_000 + 214_000),
        steps: [],
      },
    },
    {
      id: "rider-idle-quit",
      name: "Rider 空闲退出",
      path: "C:/Users/firoyang/AppData/Roaming/cronkit",
      autoScheduled: true,
      scheduleId: "idle-watch",
      cron: "*/15 0-7 * * *",
      nextRun: iso(11 * 60_000),
      running: false,
      steps: ["kill-process (timeout 1m)"],
      lastRun: {
        runId: "run-3",
        workspaceId: "rider-idle-quit",
        workspaceName: "Rider 空闲退出",
        scheduleId: "idle-watch",
        localDate: day,
        trigger: "schedule",
        status: "skipped",
        startedAt: iso(-46 * 60_000),
        finishedAt: iso(-46 * 60_000 + 900),
        steps: [],
      },
    },
    {
      id: "sandbox",
      name: "临时沙箱",
      path: "D:/workspace/Sandbox_VeryLongPathName_ThatKeepsGoing/Client/Assets",
      autoScheduled: false,
      scheduleId: "manual",
      cron: "-",
      nextRun: null,
      running: false,
      steps: ["run-script (timeout 30m)"],
    },
  ],
  runs: [
    {
      runId: "run-1",
      workspaceId: "osg-branch-1",
      workspaceName: "OSG 分支 1",
      scheduleId: "manual",
      localDate: day,
      trigger: "manual",
      status: "running",
      startedAt: iso(-4 * 60_000),
      steps: [
        {
          index: 0,
          type: "svn-update",
          status: "succeeded",
          summary: "svn-update follow-latest",
          startedAt: iso(-4 * 60_000),
          finishedAt: iso(-90_000),
          exitCode: 0,
          outputTail:
            "Updating '.':\nU    Assets/Scripts/Gameplay/CombatResolver.cs\nUpdated to revision 772158.",
        },
        {
          index: 1,
          type: "unity-warmup",
          status: "running",
          summary: "unity-warmup 6000.0.58f1",
          startedAt: iso(-90_000),
        },
      ],
    },
    {
      runId: "run-2",
      workspaceId: "osg-core-only",
      workspaceName: "OSGameCoreOnlyX",
      scheduleId: "nightly-0210",
      localDate: day,
      trigger: "schedule",
      status: "failed",
      startedAt: iso(-3 * 3600_000),
      finishedAt: iso(-3 * 3600_000 + 214_000),
      steps: [
        {
          index: 0,
          type: "svn-update",
          status: "failed",
          summary: "svn-update follow-latest",
          startedAt: iso(-3 * 3600_000),
          finishedAt: iso(-3 * 3600_000 + 214_000),
          exitCode: 1,
          error:
            "svn: E155037: Previous operation has not finished; run 'cleanup' if it was interrupted",
        },
      ],
    },
    {
      runId: "run-3",
      workspaceId: "rider-idle-quit",
      workspaceName: "Rider 空闲退出",
      scheduleId: "idle-watch",
      localDate: day,
      trigger: "schedule",
      status: "skipped",
      startedAt: iso(-46 * 60_000),
      finishedAt: iso(-46 * 60_000 + 900),
      steps: [
        {
          index: 0,
          type: "kill-process",
          status: "skipped",
          summary: "kill-process rider64",
          startedAt: iso(-46 * 60_000),
          finishedAt: iso(-46 * 60_000 + 900),
          outputTail: "idle 7s from 3600s，未达到阈值，本次跳过",
        },
      ],
    },
    {
      runId: "run-4",
      workspaceId: "osg-branch-1",
      workspaceName: "OSG 分支 1",
      scheduleId: "nightly-0210",
      localDate: day,
      trigger: "catch-up",
      status: "succeeded",
      startedAt: iso(-9 * 3600_000),
      finishedAt: iso(-9 * 3600_000 + 1_842_000),
      steps: [
        {
          index: 0,
          type: "svn-update",
          status: "succeeded",
          summary: "svn-update follow-latest",
          startedAt: iso(-9 * 3600_000),
          finishedAt: iso(-9 * 3600_000 + 402_000),
          exitCode: 0,
          outputTail: "Updated to revision 771904.",
        },
        {
          index: 1,
          type: "unity-warmup",
          status: "succeeded",
          summary: "unity-warmup 6000.0.58f1",
          startedAt: iso(-9 * 3600_000 + 402_000),
          finishedAt: iso(-9 * 3600_000 + 1_842_000),
          exitCode: 0,
          outputTail: "Unity 已完成导入，退出码 0",
        },
      ],
    },
  ],
};

const editor: ConfigEditorPayload = {
  path: snapshot.configPath,
  text: `# mock — not a real config file
version: 1
timezone: Asia/Shanghai
`,
  toolsets: snapshot.toolsets ?? [],
  draft: {
    version: 1,
    timezone: "Asia/Shanghai",
    runtime: { maxConcurrentRuns: 2, catchUpPreviousDays: 1, retryFailedOnCatchUp: true },
    schedules: [
      {
        id: "nightly-0210",
        description: "夜间主更新",
        cron: "10 2 * * *",
        workspaceIds: ["osg-branch-1", "osg-core-only"],
      },
      { id: "idle-watch", description: "空闲回收", cron: "*/15 0-7 * * *", workspaceIds: ["rider-idle-quit"] },
    ],
    workspaces: snapshot.workspaces.map((item) => ({
      id: item.id,
      name: item.name,
      path: item.path,
      oncePerDay: true,
      steps: [
        {
          toolsetId: "builtin",
          tool: "svn-update",
          timeout: "2h",
          retry: 1,
          params: { strategy: "follow-latest", onConflict: "fail" },
        },
      ],
    })),
    reporting: {},
    brain: {},
  },
};

const ok = { ok: true as const };
const listeners = new Set<(next: Snapshot) => void>();

function emit(): void {
  const copy = structuredClone(snapshot);
  for (const handler of listeners) {
    handler(copy);
  }
}

function clone(): Snapshot {
  return structuredClone(snapshot);
}

export function installMockApi(): void {
  const api: DesktopApi = {
    getSnapshot: async () => clone(),
    runWorkspace: async () => clone(),
    cancelRun: async () => undefined,
    catchUp: async () => clone(),
    reloadConfig: async () => clone(),
    getConfigEditor: async () => structuredClone(editor),
    validateConfig: async () => ok,
    saveConfigText: async () => clone(),
    saveConfigDraft: async () => clone(),
    pickFolder: async () => null,
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
    updateToolset: async () => clone(),
    onSnapshot: (handler) => {
      listeners.add(handler);
      return () => listeners.delete(handler);
    },
  };
  window.api = api;
}

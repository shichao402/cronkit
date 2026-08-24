import type { DesktopApi } from "../../src/renderer/global";
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
              timeout: "90m",
              params: { nographics: false },
            },
          ],
        },
        {
          id: "osg-core-only",
          name: "OSGameCoreOnlyX",
          path: "D:/workspace/OSGameCoreOnlyX",
          oncePerDay: true,
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
    onSnapshot: (handler) => {
      listeners.add(handler);
      return () => listeners.delete(handler);
    },
  };
  window.api = api;
}

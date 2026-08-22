import { GIT_TOOLS, isGitTool, runGitTool } from "../git";
import { svnCheckAndUpdate } from "../svn";
import { warmupUnity } from "../unity";
import { quitIdleApps } from "../idle-quit";
import { runScriptStep } from "../script";
import { runCommand } from "../exec";
import type { ToolInvocation, ToolManifest, ToolRunContext, ToolRunResult, ToolsetManifest } from "./types";
import { validateToolParams } from "./validate";

const svnUpdate: ToolManifest = {
  id: "svn-update",
  displayName: "SVN 更新",
  idempotent: true,
  requiresExclusiveWorkspace: true,
  supportsDryRun: true,
  params: [
    {
      name: "strategy",
      type: "enum",
      enum: ["follow-latest", "manual", "disabled"],
      default: "follow-latest",
      required: true,
    },
    { name: "onConflict", type: "enum", enum: ["fail", "revert"], default: "fail" },
    { name: "backupOnRevert", type: "boolean", default: true },
    { name: "backupDir", type: "string" },
    { name: "path", type: "string" },
  ],
};

const svnCleanup: ToolManifest = {
  id: "svn-cleanup",
  displayName: "SVN Cleanup",
  idempotent: true,
  requiresExclusiveWorkspace: true,
  params: [
    { name: "removeUnversioned", type: "boolean", default: false },
    { name: "path", type: "string" },
  ],
};

const svnRevert: ToolManifest = {
  id: "svn-revert",
  displayName: "SVN Revert",
  idempotent: true,
  requiresExclusiveWorkspace: true,
  params: [
    { name: "recursive", type: "boolean", default: true },
    { name: "path", type: "string" },
  ],
};

const svnSwitch: ToolManifest = {
  id: "svn-switch",
  displayName: "SVN Switch",
  idempotent: false,
  requiresExclusiveWorkspace: true,
  remoteWrite: false,
  params: [
    { name: "url", type: "string", required: true },
    { name: "confirmRemoteWrite", type: "boolean", default: false },
    { name: "path", type: "string" },
  ],
};

const svnCopy: ToolManifest = {
  id: "svn-copy",
  displayName: "SVN Copy（远端写）",
  idempotent: false,
  remoteWrite: true,
  params: [
    { name: "source", type: "string", required: true },
    { name: "destination", type: "string", required: true },
    { name: "message", type: "string", required: true },
    { name: "confirmRemoteWrite", type: "boolean", default: false },
  ],
};

const svnDelete: ToolManifest = {
  id: "svn-delete",
  displayName: "SVN Delete（远端写）",
  idempotent: false,
  remoteWrite: true,
  params: [
    { name: "target", type: "string", required: true },
    { name: "message", type: "string", required: true },
    { name: "confirmRemoteWrite", type: "boolean", default: false },
  ],
};

const unityWarmup: ToolManifest = {
  id: "unity-warmup",
  displayName: "Unity 预热",
  idempotent: true,
  requiresExclusiveWorkspace: true,
  lowPriority: true,
  supportsDryRun: true,
  params: [
    { name: "nographics", type: "boolean", default: false },
    { name: "executeMethod", type: "string" },
    { name: "path", type: "string" },
  ],
};

const quitIdle: ToolManifest = {
  id: "quit-idle",
  displayName: "空闲退出进程",
  idempotent: true,
  supportsDryRun: true,
  params: [
    { name: "processNames", type: "string[]", required: true },
    { name: "idleFor", type: "string", required: true },
    { name: "countIdleFrom", type: "string", default: "00:00" },
    { name: "until", type: "string", default: "08:00" },
    { name: "retryInterval", type: "string" },
    { name: "closeWait", type: "string", default: "3m" },
  ],
};

const script: ToolManifest = {
  id: "script",
  displayName: "自定义脚本",
  idempotent: false,
  allowRawArgs: true,
  params: [
    { name: "command", type: "string", required: true },
    { name: "args", type: "string[]", default: [] },
    { name: "path", type: "string" },
  ],
};

export const BUILTIN_MANIFEST: ToolsetManifest = {
  id: "builtin",
  displayName: "内置工具",
  schemaVersion: 1,
  tools: [
    svnUpdate,
    svnCleanup,
    svnRevert,
    svnSwitch,
    svnCopy,
    svnDelete,
    ...GIT_TOOLS,
    unityWarmup,
    quitIdle,
    script,
  ],
};

const byId = new Map(BUILTIN_MANIFEST.tools.map((t) => [t.id, t]));

export function getBuiltinTool(toolId: string): ToolManifest | undefined {
  return byId.get(toolId);
}

export function listBuiltinTools(): ToolManifest[] {
  return BUILTIN_MANIFEST.tools;
}

export async function runBuiltinTool(
  invocation: ToolInvocation,
  ctx: ToolRunContext,
): Promise<ToolRunResult> {
  const tool = byId.get(invocation.tool);
  if (!tool) {
    throw new Error(`未知内置工具: ${invocation.tool}`);
  }
  const { params, errors } = validateToolParams(tool, invocation.params, invocation.rawArgs);
  if (errors.length > 0) {
    throw new Error(errors.join("; "));
  }

  if (tool.remoteWrite && params.confirmRemoteWrite !== true) {
    throw new Error(
      `远端写操作需要 with.confirmRemoteWrite=true。计划: ${tool.id} ${JSON.stringify(params)}`,
    );
  }

  if (ctx.dryRun) {
    return { detail: `dry-run: ${tool.displayName} ${JSON.stringify(params)}`, code: 0 };
  }

  if (isGitTool(invocation.tool)) {
    return runGitTool(invocation.tool, params, ctx);
  }

  switch (invocation.tool) {
    case "svn-update":
      return runSvnUpdate(params, ctx);
    case "svn-cleanup":
      return runSvnArgs(
        ctx,
        [
          "cleanup",
          ...(params.removeUnversioned === true
            ? ["--remove-unversioned", "--remove-ignored"]
            : []),
        ],
        "svn cleanup",
      );
    case "svn-revert":
      return runSvnArgs(
        ctx,
        ["revert", ...(params.recursive === false ? [] : ["-R"]), "."],
        "svn revert",
      );
    case "svn-switch":
      return runSvnArgs(ctx, ["switch", String(params.url)], "svn switch");
    case "svn-copy":
      return runSvnArgs(
        ctx,
        ["copy", String(params.source), String(params.destination), "-m", String(params.message)],
        "svn copy",
        true,
      );
    case "svn-delete":
      return runSvnArgs(
        ctx,
        ["delete", String(params.target), "-m", String(params.message)],
        "svn delete",
        true,
      );
    case "unity-warmup":
      return warmupUnity({
        projectPath: ctx.cwd,
        timeoutMs: ctx.timeoutMs,
        logFile: ctx.logFile,
        abortSignal: ctx.abortSignal,
        nographics: params.nographics === true,
        executeMethod:
          typeof params.executeMethod === "string" ? params.executeMethod : null,
        lowPriority: true,
      });
    case "quit-idle":
      return quitIdleApps(
        {
          processNames: params.processNames as string[],
          idleFor: String(params.idleFor),
          countIdleFrom: String(params.countIdleFrom ?? "00:00"),
          until: String(params.until ?? "08:00"),
          timeout: invocation.timeout,
          retryInterval: typeof params.retryInterval === "string" ? params.retryInterval : undefined,
          closeWait: typeof params.closeWait === "string" ? params.closeWait : undefined,
        },
        ctx.logFile,
      );
    case "script":
      return runScriptStep({
        cwd: ctx.cwd,
        command: String(params.command),
        args: (params.args as string[] | undefined) ?? invocation.rawArgs ?? [],
        timeoutMs: ctx.timeoutMs,
        logFile: ctx.logFile,
        abortSignal: ctx.abortSignal,
        lowPriority: false,
      });
    default:
      throw new Error(`未实现内置工具: ${invocation.tool}`);
  }
}

async function runSvnUpdate(
  params: Record<string, unknown>,
  ctx: ToolRunContext,
): Promise<ToolRunResult> {
  const strategy = String(params.strategy ?? "follow-latest");
  if (strategy === "disabled") {
    return { detail: "strategy=disabled，跳过", code: 0, skipped: true };
  }
  const result = await svnCheckAndUpdate({
    workingCopy: ctx.cwd,
    timeoutMs: ctx.timeoutMs,
    logFile: ctx.logFile,
    abortSignal: ctx.abortSignal,
    skipUpdate: false,
    onConflict: (params.onConflict as "fail" | "revert") ?? "fail",
    backupOnRevert: params.backupOnRevert !== false,
    backupDir: typeof params.backupDir === "string" ? params.backupDir : undefined,
    localDate: ctx.localDate,
  });
  return { detail: result.detail, code: result.code, skipped: result.skipped };
}

async function runSvnArgs(
  ctx: ToolRunContext,
  args: string[],
  label: string,
  allowUrlCwd = false,
): Promise<ToolRunResult> {
  const result = await runCommand({
    command: "svn",
    args,
    cwd: allowUrlCwd ? ctx.workspacePath : ctx.cwd,
    timeoutMs: ctx.timeoutMs,
    logFile: ctx.logFile,
    abortSignal: ctx.abortSignal,
  }).done;
  if (result.cancelled) {
    throw new Error(result.timedOut ? `${label} 超时` : "已取消");
  }
  if (result.code !== 0) {
    throw new Error(tail(result.stderr || result.stdout) || `${label} 退出码 ${result.code}`);
  }
  return { detail: tail(result.stdout) || `${label} 完成`, code: result.code };
}

function tail(text: string): string {
  return text.trim().split(/\r?\n/).filter(Boolean).slice(-8).join("\n");
}

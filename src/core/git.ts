import { existsSync } from "node:fs";
import path from "node:path";
import { runCommand } from "./exec";
import type { ToolManifest, ToolRunContext, ToolRunResult } from "./toolset/types";

export const GIT_TOOLS: ToolManifest[] = [
  {
    id: "git-status",
    displayName: "Git Status",
    description: "查看工作区与分支状态",
    idempotent: true,
    supportsDryRun: true,
    params: [{ name: "path", type: "string", description: "相对工作目录的子路径" }],
  },
  {
    id: "git-fetch",
    displayName: "Git Fetch",
    description: "拉取远端引用，不合并",
    idempotent: true,
    supportsDryRun: true,
    params: [
      { name: "remote", type: "string", description: "远端名；留空则 --all" },
      { name: "prune", type: "boolean", default: true, description: "删除远端已不存在的跟踪分支" },
      { name: "path", type: "string" },
    ],
  },
  {
    id: "git-pull",
    displayName: "Git Pull",
    description: "拉取并更新当前分支（对应 SVN 更新）",
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
        description: "follow-latest 每次拉取；manual 仅手动触发；disabled 跳过",
      },
      { name: "remote", type: "string", description: "远端名，默认 origin（指定 branch 时）" },
      { name: "branch", type: "string", description: "分支名；留空则拉当前分支的上游" },
      { name: "ffOnly", type: "boolean", default: true, description: "仅快进，避免自动合并提交" },
      { name: "rebase", type: "boolean", default: false },
      { name: "path", type: "string" },
    ],
  },
  {
    id: "git-checkout",
    displayName: "Git Checkout",
    description: "切换分支或检出指定引用",
    idempotent: false,
    requiresExclusiveWorkspace: true,
    params: [
      { name: "ref", type: "string", required: true, description: "分支、tag 或 commit" },
      { name: "create", type: "boolean", default: false, description: "不存在则新建分支（-b）" },
      { name: "path", type: "string" },
    ],
  },
  {
    id: "git-stash",
    displayName: "Git Stash",
    description: "暂存或恢复本地改动",
    idempotent: false,
    requiresExclusiveWorkspace: true,
    params: [
      {
        name: "action",
        type: "enum",
        enum: ["push", "pop", "drop", "list"],
        default: "push",
        required: true,
      },
      { name: "message", type: "string", description: "push 时的说明" },
      { name: "includeUntracked", type: "boolean", default: false, description: "push 时包含未跟踪文件" },
      { name: "path", type: "string" },
    ],
  },
  {
    id: "git-clean",
    displayName: "Git Clean",
    description: "删除未跟踪文件",
    idempotent: true,
    requiresExclusiveWorkspace: true,
    params: [
      { name: "directories", type: "boolean", default: true, description: "同时删除未跟踪目录（-d）" },
      { name: "ignored", type: "boolean", default: false, description: "同时删除被 ignore 的文件（-x）" },
      { name: "path", type: "string" },
    ],
  },
  {
    id: "git-reset",
    displayName: "Git Reset",
    description: "重置 HEAD / 暂存区 / 工作区",
    idempotent: false,
    requiresExclusiveWorkspace: true,
    params: [
      {
        name: "mode",
        type: "enum",
        enum: ["mixed", "hard"],
        default: "mixed",
        required: true,
        description: "mixed 保留工作区改动；hard 丢弃本地改动",
      },
      { name: "ref", type: "string", default: "HEAD", description: "重置到的引用" },
      { name: "path", type: "string" },
    ],
  },
  {
    id: "git-commit",
    displayName: "Git Commit",
    description: "提交本地改动",
    idempotent: false,
    requiresExclusiveWorkspace: true,
    params: [
      { name: "message", type: "string", required: true },
      { name: "all", type: "boolean", default: true, description: "提交前 git add -A" },
      { name: "allowEmpty", type: "boolean", default: false },
      { name: "path", type: "string" },
    ],
  },
  {
    id: "git-push",
    displayName: "Git Push（远端写）",
    description: "推送到远端",
    idempotent: false,
    remoteWrite: true,
    requiresExclusiveWorkspace: true,
    params: [
      { name: "remote", type: "string", default: "origin" },
      { name: "ref", type: "string", description: "要推送的引用；留空则推当前分支" },
      { name: "setUpstream", type: "boolean", default: false },
      {
        name: "force",
        type: "boolean",
        default: false,
        description: "使用 --force-with-lease，避免覆盖未知远端提交",
      },
      { name: "confirmRemoteWrite", type: "boolean", default: false },
      { name: "path", type: "string" },
    ],
  },
];

const gitIds = new Set(GIT_TOOLS.map((tool) => tool.id));

export function isGitTool(toolId: string): boolean {
  return gitIds.has(toolId);
}

export async function runGitTool(
  toolId: string,
  params: Record<string, unknown>,
  ctx: ToolRunContext,
): Promise<ToolRunResult> {
  assertGitRepo(ctx.cwd);

  switch (toolId) {
    case "git-status":
      return runGit(ctx, ["status", "-sb"], "git status");
    case "git-fetch": {
      const remote = optionalString(params.remote);
      const args = ["fetch"];
      if (params.prune !== false) {
        args.push("--prune");
      }
      if (remote) {
        args.push(remote);
      } else {
        args.push("--all");
      }
      return runGit(ctx, args, "git fetch");
    }
    case "git-pull": {
      const strategy = String(params.strategy ?? "follow-latest");
      if (strategy === "disabled") {
        return { detail: "strategy=disabled，跳过", code: 0, skipped: true };
      }
      const args = ["pull"];
      if (params.ffOnly !== false) {
        args.push("--ff-only");
      }
      if (params.rebase === true) {
        args.push("--rebase");
      }
      const remote = optionalString(params.remote);
      const branch = optionalString(params.branch);
      if (remote && branch) {
        args.push(remote, branch);
      } else if (remote) {
        args.push(remote);
      } else if (branch) {
        args.push("origin", branch);
      }
      return runGit(ctx, args, "git pull");
    }
    case "git-checkout": {
      const ref = String(params.ref);
      const args = params.create === true ? ["checkout", "-b", ref] : ["checkout", ref];
      return runGit(ctx, args, "git checkout");
    }
    case "git-stash": {
      const action = String(params.action ?? "push");
      if (action === "list") {
        return runGit(ctx, ["stash", "list"], "git stash list");
      }
      if (action === "pop") {
        return runGit(ctx, ["stash", "pop"], "git stash pop");
      }
      if (action === "drop") {
        return runGit(ctx, ["stash", "drop"], "git stash drop");
      }
      const args = ["stash", "push"];
      if (params.includeUntracked === true) {
        args.push("-u");
      }
      const message = optionalString(params.message);
      if (message) {
        args.push("-m", message);
      }
      return runGit(ctx, args, "git stash");
    }
    case "git-clean": {
      const args = ["clean", "-f"];
      if (params.directories !== false) {
        args.push("-d");
      }
      if (params.ignored === true) {
        args.push("-x");
      }
      return runGit(ctx, args, "git clean");
    }
    case "git-reset": {
      const mode = String(params.mode ?? "mixed");
      const ref = optionalString(params.ref) || "HEAD";
      return runGit(ctx, ["reset", `--${mode}`, ref], "git reset");
    }
    case "git-commit":
      return runGitCommit(params, ctx);
    case "git-push": {
      const args = ["push"];
      if (params.setUpstream === true) {
        args.push("-u");
      }
      if (params.force === true) {
        args.push("--force-with-lease");
      }
      args.push(optionalString(params.remote) || "origin");
      const ref = optionalString(params.ref);
      if (ref) {
        args.push(ref);
      }
      return runGit(ctx, args, "git push");
    }
    default:
      throw new Error(`未实现 Git 工具: ${toolId}`);
  }
}

async function runGitCommit(
  params: Record<string, unknown>,
  ctx: ToolRunContext,
): Promise<ToolRunResult> {
  if (params.all !== false) {
    await runGit(ctx, ["add", "-A"], "git add");
  }
  const status = await runGit(ctx, ["status", "--porcelain"], "git status", { allowEmpty: true });
  if (!status.detail.trim() && params.allowEmpty !== true) {
    return { detail: "没有可提交的改动，跳过", code: 0, skipped: true };
  }
  const args = ["commit", "-m", String(params.message)];
  if (params.allowEmpty === true) {
    args.push("--allow-empty");
  }
  return runGit(ctx, args, "git commit");
}

export async function runGit(
  ctx: ToolRunContext,
  args: string[],
  label: string,
  options: { allowEmpty?: boolean } = {},
): Promise<ToolRunResult> {
  const result = await runCommand({
    command: "git",
    args,
    cwd: ctx.cwd,
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
  const detail = tail(result.stdout) || (options.allowEmpty ? "" : `${label} 完成`);
  return { detail, code: result.code };
}

function assertGitRepo(cwd: string): void {
  if (!existsSync(cwd)) {
    throw new Error(`目录不存在: ${cwd}`);
  }
  if (!existsSync(path.join(cwd, ".git"))) {
    throw new Error("不是 Git 仓库（缺少 .git）");
  }
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function tail(text: string): string {
  return text.trim().split(/\r?\n/).filter(Boolean).slice(-8).join("\n");
}

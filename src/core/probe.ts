import { existsSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { stepWorkingPath, type AppConfig, type Step, type Workspace } from "./config";
import { listUnityEditors, readProjectVersion } from "./unity";

export type StepProbe = {
  type: Step["type"];
  summary: string;
  ok: boolean;
  detail: string;
};

export function dryRunWorkspace(
  config: AppConfig,
  workspaceId: string,
): { workspace: Workspace; probes: StepProbe[] } {
  const workspace = config.workspaces.find((item) => item.id === workspaceId);
  if (!workspace) {
    throw new Error(`未知 workspace: ${workspaceId}`);
  }
  const probes = workspace.steps.map((step) => probeStep(workspace, step));
  return { workspace, probes };
}

function probeStep(workspace: Workspace, step: Step): StepProbe {
  const cwd = stepWorkingPath(workspace, step);
  if (step.type === "svn-update") {
    const summary = `svn-update strategy=${step.strategy}`;
    if (!existsSync(cwd)) {
      return { type: step.type, summary, ok: false, detail: `目录不存在: ${cwd}` };
    }
    if (!existsSync(path.join(cwd, ".svn"))) {
      return { type: step.type, summary, ok: false, detail: "不是 SVN 工作副本" };
    }
    if (step.strategy === "disabled") {
      return { type: step.type, summary, ok: true, detail: "disabled：任何触发都会 skipped" };
    }
    if (step.strategy === "manual") {
      return { type: step.type, summary, ok: true, detail: "manual：调度/补跑 skipped，手动才会更新" };
    }
    const info = spawnSync("svn", ["info", "--show-item", "url"], {
      cwd,
      encoding: "utf8",
      timeout: 15_000,
      windowsHide: true,
    });
    if (info.error || info.status !== 0) {
      return {
        type: step.type,
        summary,
        ok: false,
        detail: info.stderr?.trim() || info.error?.message || "svn info 失败",
      };
    }
    return { type: step.type, summary, ok: true, detail: `将更新到 HEAD: ${info.stdout.trim()}` };
  }

  if (step.type === "unity-warmup") {
    const summary = `unity-warmup timeout=${step.timeout}`;
    try {
      const version = readProjectVersion(cwd);
      const editors = listUnityEditors();
      const matched = editors.find((item) => item.version === version);
      const lockFile = path.join(cwd, "Temp", "UnityLockfile");
      if (existsSync(lockFile)) {
        return { type: step.type, summary, ok: false, detail: `Unity ${version} 项目锁存在` };
      }
      if (!matched) {
        return {
          type: step.type,
          summary,
          ok: false,
          detail: `需要 Unity ${version}，Hub 未找到匹配编辑器`,
        };
      }
      return {
        type: step.type,
        summary,
        ok: true,
        detail: `将用 ${matched.exe} 预热 ${cwd}`,
      };
    } catch (error) {
      return {
        type: step.type,
        summary,
        ok: false,
        detail: error instanceof Error ? error.message : String(error),
      };
    }
  }

  const cmdline = [step.command, ...step.args].join(" ");
  const summary = `script ${cmdline}`;
  const fileFlag = step.args.findIndex((arg) => arg === "-File");
  if (fileFlag >= 0 && step.args[fileFlag + 1]) {
    const scriptPath = path.resolve(cwd, step.args[fileFlag + 1]);
    if (!existsSync(scriptPath)) {
      return { type: step.type, summary, ok: false, detail: `脚本不存在: ${scriptPath}` };
    }
    return { type: step.type, summary, ok: true, detail: `将执行 ${scriptPath}` };
  }
  return { type: step.type, summary, ok: true, detail: `将执行: ${cmdline}` };
}

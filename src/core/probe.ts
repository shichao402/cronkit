import { existsSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import {
  findTarget,
  stepWorkingPath,
  toInvocation,
  type AppConfig,
  type Target,
} from "./config";
import { listUnityEditors, readProjectVersion } from "./unity";
import { probeQuitIdle } from "./idle-quit";
import { filterReleasable, listOccupantsSync } from "./occupants";
import {
  parseSvnStatusXml,
  resolveWriteTargets,
  revertWriteRelatives,
  updateWriteRelatives,
} from "./svn-status";
import { lookupTool, summarizeInvocation, type ToolInvocation } from "./toolset";

export type StepProbe = {
  type: string;
  summary: string;
  ok: boolean;
  detail: string;
};

/** @deprecated prefer dryRunTarget */
export function dryRunWorkspace(
  config: AppConfig,
  workspaceId: string,
  dataDir?: string,
): { workspace: Target; probes: StepProbe[] } {
  return dryRunTarget(config, workspaceId, dataDir);
}

export function dryRunTarget(
  config: AppConfig,
  targetId: string,
  dataDir?: string,
): { workspace: Target; probes: StepProbe[] } {
  const found = findTarget(config, targetId);
  if (!found) {
    throw new Error(`未知 target: ${targetId}`);
  }
  const { target } = found;
  const probes = target.steps.map((step) => probeInvocation(target, toInvocation(step), dataDir));
  return { workspace: target, probes };
}

function probeInvocation(
  workspace: Target,
  inv: ToolInvocation,
  dataDir?: string,
): StepProbe {
  const summary = summarizeInvocation(inv);
  const type = `${inv.toolsetId}/${inv.tool}`;
  const tool = lookupTool(inv.toolsetId, inv.tool, dataDir);
  if (!tool) {
    return { type, summary, ok: false, detail: `未找到工具 ${type}` };
  }

  const cwd = stepWorkingPath(workspace, inv);

  if (inv.toolsetId === "builtin" && inv.tool === "svn-update") {
    if (!existsSync(cwd)) {
      return { type, summary, ok: false, detail: `目录不存在: ${cwd}` };
    }
    if (!existsSync(path.join(cwd, ".svn"))) {
      return { type, summary, ok: false, detail: "不是 SVN 工作副本" };
    }
    if (inv.params.strategy === "disabled") {
      return { type, summary, ok: true, detail: "disabled：任何触发都会 skipped" };
    }
    if (inv.params.strategy === "manual") {
      return { type, summary, ok: true, detail: "manual：调度/补跑 skipped，手动才会更新" };
    }
    const info = spawnSync("svn", ["info", "--show-item", "url"], {
      cwd,
      encoding: "utf8",
      timeout: 15_000,
      windowsHide: true,
    });
    if (info.error || info.status !== 0) {
      return {
        type,
        summary,
        ok: false,
        detail: info.stderr?.trim() || info.error?.message || "svn info 失败",
      };
    }
    const lockDetail = describeSvnWriteLockRisk(cwd, inv.params.releaseOccupants !== false);
    return {
      type,
      summary,
      ok: true,
      detail: `将更新到 HEAD: ${info.stdout.trim()}${lockDetail ? `；${lockDetail}` : ""}`,
    };
  }

  if (inv.toolsetId === "builtin" && inv.tool === "unity-warmup") {
    try {
      const version = readProjectVersion(cwd);
      const editors = listUnityEditors();
      const matched = editors.find((item) => item.version === version);
      const lockFile = path.join(cwd, "Temp", "UnityLockfile");
      if (existsSync(lockFile)) {
        return { type, summary, ok: false, detail: `Unity ${version} 项目锁存在` };
      }
      if (!matched) {
        return {
          type,
          summary,
          ok: false,
          detail: `需要 Unity ${version}，Hub 未找到匹配编辑器`,
        };
      }
      return {
        type,
        summary,
        ok: true,
        detail: `将用 ${matched.exe} 预热 ${cwd}`,
      };
    } catch (error) {
      return {
        type,
        summary,
        ok: false,
        detail: error instanceof Error ? error.message : String(error),
      };
    }
  }

  if (inv.toolsetId === "builtin" && inv.tool === "quit-idle") {
    try {
      const detail = probeQuitIdle({
        processNames: inv.params.processNames as string[],
        idleFor: String(inv.params.idleFor),
        countIdleFrom: String(inv.params.countIdleFrom ?? "00:00"),
        until: String(inv.params.until ?? "08:00"),
        timeout: inv.timeout,
      });
      return { type, summary, ok: true, detail };
    } catch (error) {
      return {
        type,
        summary,
        ok: false,
        detail: error instanceof Error ? error.message : String(error),
      };
    }
  }

  if (inv.toolsetId === "builtin" && inv.tool === "script") {
    const command = String(inv.params.command ?? "");
    const args = (inv.params.args as string[] | undefined) ?? [];
    const cmdline = [command, ...args].join(" ");
    const fileFlag = args.findIndex((arg) => arg === "-File");
    if (fileFlag >= 0 && args[fileFlag + 1]) {
      const scriptPath = path.resolve(cwd, args[fileFlag + 1]);
      if (!existsSync(scriptPath)) {
        return { type, summary, ok: false, detail: `脚本不存在: ${scriptPath}` };
      }
      return { type, summary, ok: true, detail: `将执行 ${scriptPath}` };
    }
    return { type, summary, ok: true, detail: `将执行: ${cmdline}` };
  }

  if (inv.toolsetId !== "builtin") {
    if (tool.supportsDryRun) {
      return {
        type,
        summary,
        ok: true,
        detail: `外置工具已安装，支持 dry-run（真正预检请用试运行）`,
      };
    }
    return {
      type,
      summary,
      ok: true,
      detail: `外置工具 ${tool.displayName} 已就绪`,
    };
  }

  return { type, summary, ok: true, detail: `${tool.displayName} 可执行` };
}

function describeSvnWriteLockRisk(cwd: string, releaseOccupants: boolean): string {
  const remote = spawnSync("svn", ["status", "-u", "--xml"], {
    cwd,
    encoding: "utf8",
    timeout: 60_000,
    windowsHide: true,
  });
  const xml = remote.status === 0 ? remote.stdout || "" : "";
  const localOnly = remote.status !== 0;
  const sourceXml =
    xml.trim() ||
    spawnSync("svn", ["status", "--xml"], {
      cwd,
      encoding: "utf8",
      timeout: 30_000,
      windowsHide: true,
    }).stdout ||
    "";
  const entries = parseSvnStatusXml(sourceXml);
  const incoming = localOnly ? [] : updateWriteRelatives(entries, false);
  const local = revertWriteRelatives(entries);
  const writeRels = incoming.length > 0 ? incoming : [];
  const parts = [
    localOnly ? "无法联系仓库，仅本地 status" : `更新将写入 ${incoming.length} 个路径`,
    `本地脏路径 ${local.length}`,
  ];
  if (process.platform !== "win32" || writeRels.length === 0) {
    return parts.join("，");
  }
  const occupants = filterReleasable(listOccupantsSync(cwd, resolveWriteTargets(cwd, writeRels)));
  if (occupants.length === 0) {
    return `${parts.join("，")}；当前未见可释放占用`;
  }
  const names = occupants.map((item) => `${item.name}(${item.pid})`).join(", ");
  const action = releaseOccupants ? "实际更新时将尝试结束这些进程" : "已关闭自动释放，更新可能被独占打断";
  return `${parts.join("，")}；可能占用: ${names}。${action}`;
}

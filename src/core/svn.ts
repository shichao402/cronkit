import { appendFileSync, cpSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { runCommand } from "./exec";
import { prepareExclusiveAccess } from "./occupants";
import {
  isSvnLockError,
  parseSvnStatusXml,
  pathsFromSvnError,
  resolveWriteTargets,
  revertWriteRelatives,
  updateWriteRelatives,
} from "./svn-status";

export type ConflictPolicy = "fail" | "revert";

export async function svnCheckAndUpdate(options: {
  workingCopy: string;
  timeoutMs: number;
  logFile: string;
  abortSignal: AbortSignal;
  skipUpdate: boolean;
  onConflict?: ConflictPolicy;
  backupOnRevert?: boolean;
  backupDir?: string;
  localDate?: string;
  releaseOccupants?: boolean;
}): Promise<{ skipped: boolean; detail: string; code: number | null }> {
  if (!existsSync(options.workingCopy)) {
    throw new Error(`目录不存在: ${options.workingCopy}`);
  }
  if (!existsSync(path.join(options.workingCopy, ".svn"))) {
    throw new Error("不是 SVN 工作副本（缺少 .svn）");
  }

  const policy = options.onConflict ?? "fail";
  const notes: string[] = [];
  const canRelease = options.releaseOccupants === true && process.platform === "win32";

  if (existsSync(path.join(options.workingCopy, ".svn", "lock"))) {
    if (policy !== "revert") {
      throw new Error("工作副本有 in-progress 锁（.svn/lock），未执行 cleanup");
    }
    if (canRelease) {
      await releasePredicted(options, [], "in-progress 锁");
    }
    await runSvn(options, ["cleanup"], "svn cleanup");
    notes.push("已 svn cleanup 解除 in-progress 锁");
  }

  const status = await runSvn(options, ["status", "--xml"], "svn status");
  let statusXml = status.stdout;
  let incomingXml: string | undefined;
  if (!options.skipUpdate) {
    const remote = await runSvn(options, ["status", "-u", "--xml"], "svn status -u", true);
    if (remote.code === 0 && remote.stdout.trim()) {
      incomingXml = remote.stdout;
      statusXml = incomingXml;
    } else {
      notes.push("无法取得远端状态，仅按本地 svn status 估计写集");
    }
  }

  const predicted = predictWriteRelatives(statusXml, incomingXml, {
    skipUpdate: options.skipUpdate,
    willRevertProblems: policy === "revert" && Boolean(findSvnProblem(status.stdout)),
  });
  logWriteSet(options.logFile, predicted, incomingXml ? "update" : "local");

  if (canRelease && predicted.rels.length > 0) {
    const released = await releasePredicted(options, predicted.rels, "svn-update 写集");
    if (released) {
      notes.push(released);
    }
  } else if (predicted.rels.length > 0 && !canRelease) {
    notes.push(
      `预计写入 ${predicted.rels.length} 个路径（未自动释放占用；可将 with.releaseOccupants 设为 true）`,
    );
  }

  const problem = findSvnProblem(status.stdout);
  if (problem) {
    if (policy !== "revert") {
      throw new Error(`${problem}。已保留现场，未自动 cleanup/revert`);
    }
    const backup = await backupDirty(options, status.stdout);
    if (backup) {
      notes.push(`冲突/改动已备份到 ${backup}`);
    }
    if (canRelease) {
      await releasePredicted(options, revertWriteRelatives(parseSvnStatusXml(status.stdout)), "svn revert");
    }
    await resetWorkingCopy(options);
    notes.push("已按 onConflict=revert 执行 cleanup/revert");
  }

  if (options.skipUpdate) {
    return { skipped: true, detail: notes.join("；") || "按策略跳过 svn update", code: 0 };
  }

  const update = await runSvn(options, ["update"], "svn update", true);
  if (update.code === 0) {
    notes.push(tail(update.stdout) || "svn update 完成");
    return { skipped: false, detail: notes.join("；"), code: update.code };
  }

  const updateProblem =
    findSvnProblem(update.stdout + update.stderr) ?? tail(update.stderr) ?? `svn update 退出码 ${update.code}`;
  const lockHit = isSvnLockError(update.stdout + update.stderr);

  if (canRelease && lockHit) {
    const extra = pathsFromSvnError(`${update.stdout}\n${update.stderr}`).map((item) =>
      path.isAbsolute(item) ? path.relative(options.workingCopy, item) : item,
    );
    notes.push("更新被文件独占打断，cleanup 并释放占用后重试");
    await runSvn(options, ["cleanup"], "svn cleanup", true);
    await releasePredicted(options, [...predicted.rels, ...extra], "update 独占重试");
    const retry = await runSvn(options, ["update"], "svn update retry", true);
    if (retry.code === 0) {
      notes.push("释放占用后已重新 update");
      return { skipped: false, detail: [...notes, tail(retry.stdout) || "svn update 完成"].join("；"), code: retry.code };
    }
  }

  if (policy !== "revert") {
    throw new Error(updateProblem);
  }
  const backup = await backupDirty(
    options,
    (await runSvn(options, ["status", "--xml"], "svn status", true)).stdout,
  );
  if (backup) {
    notes.push(`更新失败后的改动已备份到 ${backup}`);
  }
  if (canRelease) {
    await releasePredicted(options, predicted.rels, "update 失败后 revert");
  }
  await resetWorkingCopy(options);
  const retry = await runSvn(options, ["update"], "svn update retry");
  notes.push("revert 后已重新 update");
  return { skipped: false, detail: [...notes, tail(retry.stdout) || "svn update 完成"].join("；"), code: retry.code };
}

export async function svnRevertTree(options: {
  workingCopy: string;
  timeoutMs: number;
  logFile: string;
  abortSignal: AbortSignal;
  recursive?: boolean;
  releaseOccupants?: boolean;
}): Promise<{ detail: string; code: number | null }> {
  const status = await runSvn(options, ["status", "--xml"], "svn status", true);
  const rels = revertWriteRelatives(parseSvnStatusXml(status.stdout));
  logWriteSet(options.logFile, { rels, incoming: 0, local: rels.length }, "revert");
  if (options.releaseOccupants === true && process.platform === "win32") {
    await releasePredicted(options, rels, "svn revert 写集");
  }
  const args = ["revert", ...(options.recursive === false ? [] : ["-R"]), "."];
  const result = await runSvn(options, args, "svn revert");
  return { detail: tail(result.stdout) || "svn revert 完成", code: result.code };
}

function predictWriteRelatives(
  localXml: string,
  incomingXml: string | undefined,
  options: { skipUpdate: boolean; willRevertProblems: boolean },
): { rels: string[]; incoming: number; local: number } {
  const localEntries = parseSvnStatusXml(localXml);
  const local = revertWriteRelatives(localEntries);
  if (options.skipUpdate) {
    return {
      rels: options.willRevertProblems ? local : [],
      incoming: 0,
      local: local.length,
    };
  }
  const incomingEntries = parseSvnStatusXml(incomingXml ?? localXml);
  const incoming = updateWriteRelatives(incomingEntries, false);
  const rels = options.willRevertProblems
    ? [...new Set([...incoming, ...local])]
    : incoming;
  return { rels, incoming: incoming.length, local: local.length };
}

function logWriteSet(
  logFile: string,
  predicted: { rels: string[]; incoming: number; local: number },
  kind: string,
): void {
  const preview = predicted.rels.slice(0, 30).join("\n  ");
  const extra = predicted.rels.length > 30 ? `\n  …共 ${predicted.rels.length} 个` : "";
  appendLog(
    logFile,
    `[cronkit] svn 写集(${kind}) incoming=${predicted.incoming} localDirty=${predicted.local} probe=${predicted.rels.length}` +
      (preview ? `\n  ${preview}${extra}` : " (无)"),
  );
}

async function releasePredicted(
  options: { workingCopy: string; abortSignal: AbortSignal; logFile: string },
  rels: string[],
  label: string,
): Promise<string | undefined> {
  const extraFiles = resolveWriteTargets(options.workingCopy, rels);
  const prepared = await prepareExclusiveAccess({
    target: options.workingCopy,
    abortSignal: options.abortSignal,
    extraFiles,
    includeUnityByName: false,
  });
  const closed = prepared.closed.map((item) => `${item.name}(${item.pid})`).join(", ");
  appendLog(
    options.logFile,
    `[cronkit] ${label} 释放占用 closed=${prepared.closed.length}${closed ? ` ${closed}` : ""} remaining=${prepared.remaining.length}`,
  );
  if (prepared.remaining.length > 0) {
    const names = prepared.remaining.map((item) => `${item.name}(${item.pid})`).join(", ");
    throw new Error(`无法释放 SVN 写路径占用: ${names}`);
  }
  if (prepared.remainingLocks.length > 0) {
    throw new Error(`无法释放 Unity 项目锁: ${prepared.remainingLocks.join(", ")}`);
  }
  if (prepared.closed.length === 0) {
    return undefined;
  }
  return `已结束占用进程 ${closed}`;
}

function appendLog(logFile: string, line: string): void {
  mkdirSync(path.dirname(logFile), { recursive: true });
  appendFileSync(logFile, `${line}\n`, "utf8");
}

async function runSvn(
  options: {
    workingCopy: string;
    timeoutMs: number;
    logFile: string;
    abortSignal: AbortSignal;
  },
  args: string[],
  label: string,
  allowFail = false,
) {
  const result = await runCommand({
    command: "svn",
    args,
    cwd: options.workingCopy,
    timeoutMs: args.includes("status") ? Math.min(options.timeoutMs, 10 * 60_000) : options.timeoutMs,
    logFile: options.logFile,
    abortSignal: options.abortSignal,
  }).done;
  if (result.cancelled) {
    throw new Error(result.timedOut ? `${label} 超时` : "已取消");
  }
  if (!allowFail && result.code !== 0) {
    throw new Error(tail(result.stderr) || `${label} 退出码 ${result.code}`);
  }
  return result;
}

async function resetWorkingCopy(options: {
  workingCopy: string;
  timeoutMs: number;
  logFile: string;
  abortSignal: AbortSignal;
}): Promise<void> {
  await runSvn(options, ["cleanup"], "svn cleanup", true);
  await runSvn(options, ["revert", "-R", "."], "svn revert");
  await runSvn(options, ["cleanup", "--remove-unversioned", "--remove-ignored"], "svn cleanup unversioned", true);
}

async function backupDirty(
  options: {
    workingCopy: string;
    backupOnRevert?: boolean;
    backupDir?: string;
    localDate?: string;
  },
  statusXml: string,
): Promise<string | undefined> {
  if (options.backupOnRevert === false) {
    return undefined;
  }
  const rels = revertWriteRelatives(parseSvnStatusXml(statusXml)).filter((rel) => !shouldSkipBackup(rel));
  const root = resolveBackupRoot(options.workingCopy, options.backupDir);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const destRoot = path.join(root, options.localDate ?? stamp.slice(0, 10), stamp);
  mkdirSync(destRoot, { recursive: true });
  const copied: string[] = [];
  for (const rel of rels) {
    const from = path.join(options.workingCopy, rel);
    if (!existsSync(from)) {
      continue;
    }
    const to = path.join(destRoot, rel);
    mkdirSync(path.dirname(to), { recursive: true });
    cpSync(from, to, {
      recursive: true,
      force: true,
      filter: (src) => !shouldSkipBackup(path.relative(options.workingCopy, src)),
    });
    copied.push(rel);
  }
  writeFileSync(path.join(destRoot, "manifest.txt"), copied.join("\n") || "(没有可备份的脏文件)", "utf8");
  return destRoot;
}

function resolveBackupRoot(workingCopy: string, backupDir?: string): string {
  if (backupDir) {
    return path.isAbsolute(backupDir) ? backupDir : path.resolve(workingCopy, backupDir);
  }
  return `${workingCopy.replace(/[\\/]+$/, "")}_backup`;
}

function shouldSkipBackup(rel: string): boolean {
  const norm = rel.replace(/\\/g, "/").replace(/^\.\//, "");
  return (
    norm === ".svn" ||
    norm.startsWith(".svn/") ||
    norm === "Library" ||
    norm.startsWith("Library/") ||
    norm === "Temp" ||
    norm.startsWith("Temp/") ||
    norm === "Logs" ||
    norm.startsWith("Logs/") ||
    norm.includes("/Library/") ||
    norm.includes("/Temp/")
  );
}

function findSvnProblem(xml: string): string | undefined {
  if (/item="conflicted"/.test(xml) || />conflicted</.test(xml)) {
    return "工作副本存在冲突";
  }
  if (/item="obstructed"/.test(xml)) {
    return "工作副本存在 obstructed 路径";
  }
  if (/item="incomplete"/.test(xml)) {
    return "工作副本不完整";
  }
  if (/wc-locked="true"/.test(xml)) {
    return "工作副本被锁定";
  }
  return undefined;
}

function tail(text: string): string {
  return text.trim().split(/\r?\n/).filter(Boolean).slice(-8).join("\n");
}

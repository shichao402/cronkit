import { cpSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { runCommand } from "./exec";

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
}): Promise<{ skipped: boolean; detail: string; code: number | null }> {
  if (!existsSync(options.workingCopy)) {
    throw new Error(`目录不存在: ${options.workingCopy}`);
  }
  if (!existsSync(path.join(options.workingCopy, ".svn"))) {
    throw new Error("不是 SVN 工作副本（缺少 .svn）");
  }

  const policy = options.onConflict ?? "fail";
  const notes: string[] = [];

  if (existsSync(path.join(options.workingCopy, ".svn", "lock"))) {
    if (policy !== "revert") {
      throw new Error("工作副本有 in-progress 锁（.svn/lock），未执行 cleanup");
    }
    await runSvn(options, ["cleanup"], "svn cleanup");
    notes.push("已 svn cleanup 解除 in-progress 锁");
  }

  const status = await runSvn(options, ["status", "--xml"], "svn status");
  const problem = findSvnProblem(status.stdout);
  if (problem) {
    if (policy !== "revert") {
      throw new Error(`${problem}。已保留现场，未自动 cleanup/revert`);
    }
    const backup = await backupDirty(options, status.stdout);
    if (backup) {
      notes.push(`冲突/改动已备份到 ${backup}`);
    }
    await resetWorkingCopy(options);
    notes.push("已按 onConflict=revert 执行 cleanup/revert");
  }

  if (options.skipUpdate) {
    return { skipped: true, detail: notes.join("；") || "按策略跳过 svn update", code: 0 };
  }

  const update = await runSvn(options, ["update"], "svn update", true);
  if (update.code !== 0) {
    const updateProblem = findSvnProblem(update.stdout + update.stderr) ?? tail(update.stderr) ?? `svn update 退出码 ${update.code}`;
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
    await resetWorkingCopy(options);
    const retry = await runSvn(options, ["update"], "svn update retry");
    notes.push("revert 后已重新 update");
    return { skipped: false, detail: [...notes, tail(retry.stdout) || "svn update 完成"].join("；"), code: retry.code };
  }

  notes.push(tail(update.stdout) || "svn update 完成");
  return { skipped: false, detail: notes.join("；"), code: update.code };
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
  const rels = dirtyRelativePaths(statusXml).filter((rel) => !shouldSkipBackup(rel));
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

function dirtyRelativePaths(xml: string): string[] {
  const found = new Set<string>();
  const re = /<entry\s+path="([^"]+)"[\s\S]*?<wc-status[^>]*\bitem="([^"]+)"/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(xml))) {
    const item = match[2];
    if (["normal", "none", "external"].includes(item)) {
      continue;
    }
    found.add(match[1].replace(/\//g, path.sep));
  }
  return [...found];
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

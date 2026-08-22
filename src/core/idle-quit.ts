import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseTimeout } from "./time";

export type QuitIdleStep = {
  processNames: string[];
  idleFor: string;
  countIdleFrom: string;
  until: string;
  timeout: string;
  retryInterval?: string;
  closeWait?: string;
};

function helperScript(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    process.resourcesPath ? path.join(process.resourcesPath, "scripts", "quit-idle-apps.ps1") : "",
    path.resolve(here, "../../scripts/quit-idle-apps.ps1"),
    path.resolve(here, "../scripts/quit-idle-apps.ps1"),
    path.resolve(process.cwd(), "scripts/quit-idle-apps.ps1"),
  ].filter(Boolean);
  const found = candidates.find((item) => existsSync(item));
  if (!found) {
    throw new Error("找不到 scripts/quit-idle-apps.ps1");
  }
  return found;
}

function parseJsonTail(stdout: string): Record<string, unknown> {
  const lines = stdout.trim().split(/\r?\n/).filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    try {
      return JSON.parse(lines[i]) as Record<string, unknown>;
    } catch {
      // 继续找最后一行 JSON
    }
  }
  throw new Error(stdout.trim() || "quit-idle 没有输出");
}

export function probeQuitIdle(step: QuitIdleStep): string {
  const script = helperScript();
  const result = spawnSync(
    "powershell",
    [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      script,
      "-ProcessNames",
      step.processNames.join(","),
      "-IdleForMs",
      "0",
      "-QueryOnly",
    ],
    { encoding: "utf8", windowsHide: true, timeout: 20_000 },
  );
  const parsed = parseJsonTail(result.stdout || "");
  const count = Number(parsed.count ?? 0);
  const names = Array.isArray(parsed.names) ? parsed.names.join(", ") : "";
  if (count <= 0) {
    return `当前没有 ${step.processNames.join("/")}`;
  }
  return `当前 ${count} 个进程 (${names})`;
}

export async function quitIdleApps(
  step: QuitIdleStep,
  logFile: string,
): Promise<{ detail: string; code: number; skipped?: boolean }> {
  mkdirSync(path.dirname(logFile), { recursive: true });
  const log = (line: string): void => {
    appendFileSync(logFile, `${line}\n`, "utf8");
  };
  const script = helperScript();
  const idleForMs = parseTimeout(step.idleFor);
  const retryIntervalMs = step.retryInterval ? parseTimeout(step.retryInterval) : 0;
  const waitMs =
    retryIntervalMs > 0 ? parseTimeout(step.closeWait ?? "3m") : parseTimeout(step.timeout);
  const spawnTimeoutMs = parseTimeout(step.timeout) + 30_000;
  log(
    `quit-idle ${step.processNames.join(",")} idleFor=${step.idleFor} from=${step.countIdleFrom} until=${step.until}` +
      (retryIntervalMs > 0 ? ` retryInterval=${step.retryInterval}` : ""),
  );
  const result = spawnSync(
    "powershell",
    [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      script,
      "-ProcessNames",
      step.processNames.join(","),
      "-IdleForMs",
      String(idleForMs),
      "-CountIdleFrom",
      step.countIdleFrom,
      "-Until",
      step.until,
      "-WaitMs",
      String(waitMs),
      "-RetryIntervalMs",
      String(retryIntervalMs),
    ],
    { encoding: "utf8", windowsHide: true, timeout: spawnTimeoutMs },
  );
  const combined = `${result.stdout || ""}\n${result.stderr || ""}`;
  log(combined.trim());
  if (result.error) {
    throw new Error(result.error.message);
  }
  const parsed = parseJsonTail(result.stdout || combined);
  const action = String(parsed.action ?? "");
  const reason = describeIdleReason(action, String(parsed.reason ?? ""), parsed);
  if (result.status === 2 || action === "timeout") {
    throw new Error(reason);
  }
  if (result.status !== 0) {
    throw new Error(reason || combined.trim() || `退出码 ${result.status}`);
  }
  return { detail: reason, code: 0, skipped: action === "skip" || action === "none" };
}

function describeIdleReason(action: string, code: string, parsed: Record<string, unknown>): string {
  if (code === "leftover-no-window") {
    return "进程仍在但没有窗口，无法正常退出（可能是残留进程）";
  }
  if (action === "timeout" || code === "graceful-timeout") {
    return "等待正常退出超时，未强制结束（避免索引损坏）";
  }
  if (code === "outside-window") {
    return "不在夜间窗口内";
  }
  if (code === "idle-too-short") {
    const elapsed = Number(parsed.elapsedMs ?? 0);
    const need = Number(parsed.needMs ?? 0);
    return `空闲未满阈值（已 ${(elapsed / 60000).toFixed(0)} / 需 ${(need / 60000).toFixed(0)} 分钟）`;
  }
  if (code === "no-process" || action === "none") {
    return "没有 Rider 进程";
  }
  if (code === "closed" || action === "close") {
    return "已发送关闭并正常退出";
  }
  return code || action;
}

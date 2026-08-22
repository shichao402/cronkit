import { spawnSync } from "node:child_process";
import { existsSync, unlinkSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export type Occupant = {
  pid: number;
  name: string;
  source: string;
  commandLine?: string;
};

const PROTECTED_NAMES = new Set([
  "explorer",
  "dwm",
  "csrss",
  "winlogon",
  "services",
  "lsass",
  "smss",
  "svchost",
  "system",
  "registry",
  "idle",
  "searchindexer",
  "msmpeng",
  "securityhealthservice",
  "sihost",
  "ctfmon",
  "runtimebroker",
  "startmenuexperiencehost",
  "shellexperiencehost",
  "textinputhost",
  "fontdrvhost",
  "conhost",
  "cursor",
  "code",
  "electron",
  "node",
  "powershell",
  "pwsh",
]);

const ALWAYS_RELEASE = new Set([
  "unity",
  "unitycrashhandler64",
  "unitycrashhandler32",
  "unityshadercompiler",
  "unity.licensing.client",
  "tsvncache",
]);

// 强杀会损坏这些 IDE 的索引，只请求正常关闭；关不掉就让任务失败并报告。
const NEVER_FORCE_KILL = ["rider", "idea", "clion", "webstorm", "pycharm", "goland", "devenv"];

function helperScript(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    process.resourcesPath ? path.join(process.resourcesPath, "scripts", "list-occupants.ps1") : "",
    path.resolve(here, "../../scripts/list-occupants.ps1"),
    path.resolve(here, "../scripts/list-occupants.ps1"),
    path.resolve(process.cwd(), "scripts/list-occupants.ps1"),
  ].filter(Boolean);
  const found = candidates.find((item) => existsSync(item));
  if (!found) {
    throw new Error("找不到 scripts/list-occupants.ps1");
  }
  return found;
}

export function listOccupants(target: string): Occupant[] {
  const script = helperScript();
  const result = spawnSync(
    "powershell",
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script, "-Target", target],
    { encoding: "utf8", windowsHide: true, timeout: 30_000 },
  );
  const raw = (result.stdout || "").trim();
  if (!raw) {
    return [];
  }
  try {
    const parsed = JSON.parse(raw) as Occupant | Occupant[];
    const list = Array.isArray(parsed) ? parsed : [parsed];
    return list.filter((item) => Number.isFinite(item.pid) && item.pid > 0);
  } catch {
    return [];
  }
}

function isAlwaysRelease(item: Occupant): boolean {
  const base = path.parse(item.name).name.toLowerCase();
  const full = item.name.toLowerCase();
  return [...ALWAYS_RELEASE].some((name) => base.includes(name) || full.includes(name));
}

function isNeverForceKill(item: Occupant): boolean {
  const base = path.parse(item.name).name.toLowerCase();
  return NEVER_FORCE_KILL.some((name) => base.includes(name));
}

function isUnityEditorFamily(item: Occupant): boolean {
  const base = path.parse(item.name).name.toLowerCase();
  const full = item.name.toLowerCase();
  return ["unity", "unitycrashhandler", "unityshadercompiler", "unity.licensing.client"].some(
    (name) => base.includes(name) || full.includes(name),
  );
}

export function filterReleasable(occupants: Occupant[]): Occupant[] {
  const self = new Set([process.pid, process.ppid ?? 0]);
  const unique = new Map<number, Occupant>();
  for (const item of occupants) {
    if (self.has(item.pid)) {
      continue;
    }
    const base = path.parse(item.name).name.toLowerCase();
    if (PROTECTED_NAMES.has(base) && !isAlwaysRelease(item)) {
      continue;
    }
    if (item.source === "cmdline" && !isAlwaysRelease(item)) {
      continue;
    }
    unique.set(item.pid, item);
  }
  return [...unique.values()];
}

/** Parse `tasklist /FO CSV /NH` rows; used to catch Unity even when CommandLine is empty. */
export function parseTasklistCsv(stdout: string): Occupant[] {
  const found: Occupant[] = [];
  for (const line of stdout.split(/\r?\n/)) {
    const match = line.match(/^"([^"]+)","(\d+)"/);
    if (!match) {
      continue;
    }
    const item: Occupant = { pid: Number(match[2]), name: match[1], source: "process-name" };
    if (!Number.isFinite(item.pid) || item.pid <= 0) {
      continue;
    }
    if (isUnityEditorFamily(item)) {
      found.push(item);
    }
  }
  return found;
}

export function listUnityProcessesByName(): Occupant[] {
  const result = spawnSync("tasklist", ["/FO", "CSV", "/NH"], {
    encoding: "utf8",
    windowsHide: true,
    timeout: 15_000,
  });
  return parseTasklistCsv(result.stdout || "");
}

export function unityLockFiles(workspaceRoot: string): string[] {
  return [
    path.join(workspaceRoot, "Temp", "UnityLockfile"),
    path.join(workspaceRoot, "Project", "Temp", "UnityLockfile"),
  ].filter((file) => existsSync(file));
}

function taskkill(pid: number, force: boolean): void {
  const args = force ? ["/PID", String(pid), "/T", "/F"] : ["/PID", String(pid), "/T"];
  spawnSync("taskkill", args, { windowsHide: true, stdio: "ignore" });
}

function stillAlive(pid: number): boolean {
  const result = spawnSync("tasklist", ["/FI", `PID eq ${pid}`, "/NH"], {
    encoding: "utf8",
    windowsHide: true,
  });
  return (result.stdout || "").includes(String(pid));
}

async function waitMs(ms: number, signal?: AbortSignal): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(new Error("已取消"));
      },
      { once: true },
    );
  });
}

export async function releaseOccupants(options: {
  target: string;
  graceMs?: number;
  abortSignal?: AbortSignal;
}): Promise<{ closed: Occupant[]; remaining: Occupant[] }> {
  const prepared = await prepareExclusiveAccess(options);
  return { closed: prepared.closed, remaining: prepared.remaining };
}

export async function prepareExclusiveAccess(options: {
  target: string;
  graceMs?: number;
  abortSignal?: AbortSignal;
  lockWaitMs?: number;
}): Promise<{
  closed: Occupant[];
  remaining: Occupant[];
  remainingLocks: string[];
}> {
  const graceMs = options.graceMs ?? 20_000;
  const first = filterReleasable([...listOccupants(options.target), ...listUnityProcessesByName()]);
  if (first.length > 0) {
    for (const item of first) {
      if (options.abortSignal?.aborted) {
        throw new Error("已取消");
      }
      taskkill(item.pid, false);
    }
    await waitMs(Math.min(graceMs, 20_000), options.abortSignal);

    const leftover = filterReleasable([
      ...listOccupants(options.target),
      ...listUnityProcessesByName(),
    ]).filter((item) => stillAlive(item.pid));
    for (const item of leftover) {
      if (options.abortSignal?.aborted) {
        throw new Error("已取消");
      }
      if (isNeverForceKill(item)) {
        continue;
      }
      taskkill(item.pid, true);
    }
    await waitMs(2_000, options.abortSignal);
  }

  const remaining = filterReleasable([
    ...listOccupants(options.target),
    ...listUnityProcessesByName(),
  ]);
  if (remaining.length > 0) {
    return { closed: first, remaining, remainingLocks: unityLockFiles(options.target) };
  }
  const remainingLocks = await clearStaleUnityLocks(options.target, options.lockWaitMs ?? 10_000, options.abortSignal);
  return { closed: first, remaining, remainingLocks };
}

async function clearStaleUnityLocks(
  workspaceRoot: string,
  waitMsMax: number,
  abortSignal?: AbortSignal,
): Promise<string[]> {
  const deadline = Date.now() + waitMsMax;
  while (true) {
    const locks = unityLockFiles(workspaceRoot);
    if (locks.length === 0) {
      return [];
    }
    const unityAlive = filterReleasable([
      ...listOccupants(workspaceRoot),
      ...listUnityProcessesByName(),
    ]).filter(isUnityEditorFamily);
    if (unityAlive.length === 0) {
      for (const file of locks) {
        try {
          unlinkSync(file);
        } catch {
          // 锁文件可能正在被删除
        }
      }
      return unityLockFiles(workspaceRoot);
    }
    if (Date.now() >= deadline) {
      return locks;
    }
    await waitMs(500, abortSignal);
  }
}

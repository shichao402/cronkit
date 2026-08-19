import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
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

export function filterReleasable(occupants: Occupant[]): Occupant[] {
  const self = new Set([process.pid, process.ppid ?? 0]);
  const unique = new Map<number, Occupant>();
  for (const item of occupants) {
    if (self.has(item.pid)) {
      continue;
    }
    const base = path.parse(item.name).name.toLowerCase();
    if (PROTECTED_NAMES.has(base)) {
      continue;
    }
    const isUnityFamily = [...ALWAYS_RELEASE].some((name) => base.includes(name) || item.name.toLowerCase().includes(name));
    if (item.source === "cmdline" && !isUnityFamily) {
      continue;
    }
    unique.set(item.pid, item);
  }
  return [...unique.values()];
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
  const graceMs = options.graceMs ?? 20_000;
  const first = filterReleasable(listOccupants(options.target));
  if (first.length === 0) {
    return { closed: [], remaining: [] };
  }

  for (const item of first) {
    if (options.abortSignal?.aborted) {
      throw new Error("已取消");
    }
    taskkill(item.pid, false);
  }
  await waitMs(Math.min(graceMs, 20_000), options.abortSignal);

  const leftover = filterReleasable(listOccupants(options.target)).filter((item) => stillAlive(item.pid));
  for (const item of leftover) {
    if (options.abortSignal?.aborted) {
      throw new Error("已取消");
    }
    taskkill(item.pid, true);
  }
  await waitMs(2_000, options.abortSignal);

  const remaining = filterReleasable(listOccupants(options.target));
  return { closed: first, remaining };
}

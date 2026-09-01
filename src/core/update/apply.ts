import path from "node:path";

export const UPDATE_EXECUTABLE = "WorkspaceOrchestrator.exe";
export const UPDATE_APPLY_SIDECAR = "relkit-apply.exe";
export const UPDATE_ACTIVE_FILE = "active.json";
export const UPDATE_RETAIN_VERSIONS = 2;

export type ApplySessionState = "pending" | "running" | "succeeded" | "failed";

export type ApplySession = {
  state: ApplySessionState;
  pid?: number;
  startedAt?: string;
  updatedAt?: string;
  installDir: string;
  stagedRoot: string;
  targetCode: number;
  targetVersion: string;
  message?: string;
};

export type ApplyRequest = {
  installDir: string;
  stagedRoot: string;
  targetVersion: string;
  targetCode: number;
  sessionPath: string;
  logPath: string;
};

/**
 * 当前 exe 既可能在旧式单层安装根，也可能在 versions/<version>/ 下。
 * 两种形态都归一到稳定 launcher 所在的安装根，供首次迁移与后续更新共用。
 */
export function resolveInstallDir(executablePath: string): string {
  const executableDir = path.dirname(path.resolve(executablePath));
  const parent = path.dirname(executableDir);
  if (path.basename(parent).toLowerCase() === "versions") {
    return path.dirname(parent);
  }
  return executableDir;
}

export function versionPayloadDir(stagedRoot: string, version: string): string {
  assertSafeVersion(version);
  return path.join(stagedRoot, "versions", version);
}

export function buildApplyArgs(request: ApplyRequest): string[] {
  assertSafeVersion(request.targetVersion);
  if (!Number.isSafeInteger(request.targetCode) || request.targetCode <= 0) {
    throw new Error("目标版本 code 必须是正整数");
  }
  return [
    "--rup-apply",
    "--install-dir",
    request.installDir,
    "--staged-root",
    request.stagedRoot,
    "--executable",
    UPDATE_EXECUTABLE,
    "--layout",
    "versionedDir",
    "--target-version",
    request.targetVersion,
    "--target-code",
    String(request.targetCode),
    "--retain-versions",
    String(UPDATE_RETAIN_VERSIONS),
    "--apply-session",
    request.sessionPath,
    "--apply-log",
    request.logPath,
  ];
}

export function parseApplySession(value: unknown): ApplySession | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const input = value as Record<string, unknown>;
  if (
    !isSessionState(input.state) ||
    typeof input.installDir !== "string" ||
    typeof input.stagedRoot !== "string" ||
    typeof input.targetVersion !== "string" ||
    typeof input.targetCode !== "number"
  ) {
    return null;
  }
  return {
    state: input.state,
    pid: typeof input.pid === "number" ? input.pid : undefined,
    startedAt: typeof input.startedAt === "string" ? input.startedAt : undefined,
    updatedAt: typeof input.updatedAt === "string" ? input.updatedAt : undefined,
    installDir: input.installDir,
    stagedRoot: input.stagedRoot,
    targetVersion: input.targetVersion,
    targetCode: input.targetCode,
    message: typeof input.message === "string" ? input.message : undefined,
  };
}

function assertSafeVersion(version: string): void {
  if (
    version.length === 0 ||
    version === "." ||
    version === ".." ||
    version.includes("/") ||
    version.includes("\\") ||
    version.includes("\0")
  ) {
    throw new Error("目标版本号不能用作目录名");
  }
}

function isSessionState(value: unknown): value is ApplySessionState {
  return value === "pending" || value === "running" || value === "succeeded" || value === "failed";
}

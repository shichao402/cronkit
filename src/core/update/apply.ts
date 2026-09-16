import path from "node:path";

export const UPDATE_EXECUTABLE = "WorkspaceOrchestrator.exe";
export const UPDATE_SIDECAR = "relkit-updater.exe";
export const UPDATE_ACTIVE_FILE = "active.json";
export const UPDATE_RETAIN_VERSIONS = 2;

/**
 * 当前 exe 既可能在旧式单层安装根，也可能在 versions/<version>/ 下。
 * 两种形态都归一到稳定 launcher 所在的安装根。
 */
export function resolveInstallDir(executablePath: string): string {
  const executableDir = path.dirname(path.resolve(executablePath));
  const parent = path.dirname(executableDir);
  if (path.basename(parent).toLowerCase() === "versions") {
    return path.dirname(parent);
  }
  return executableDir;
}

export function updaterPath(installDir: string): string {
  return path.join(installDir, UPDATE_SIDECAR);
}

import { homedir } from "node:os";
import path from "node:path";

/** 与仓库名对齐；旧目录 `workspace-orchestrator` 由 bootstrap 一次性迁出。 */
export const DATA_DIR_NAME = "cronkit";
export const LEGACY_DATA_DIR_NAME = "workspace-orchestrator";

export function defaultDataDir(): string {
  return path.join(homedir(), "AppData", "Roaming", DATA_DIR_NAME);
}

export function legacyDataDir(): string {
  return path.join(homedir(), "AppData", "Roaming", LEGACY_DATA_DIR_NAME);
}

export function configPathIn(dataDir: string): string {
  return path.join(dataDir, "config.yaml");
}

export function statePathIn(dataDir: string): string {
  return path.join(dataDir, "state.json");
}

export function logsDirIn(dataDir: string, localDate: string, runId: string): string {
  return path.join(dataDir, "logs", localDate, runId);
}

export function normalizePathKey(p: string): string {
  return path.resolve(p).replace(/\\/g, "/").toLowerCase();
}

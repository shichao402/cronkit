import { homedir } from "node:os";
import path from "node:path";

export function defaultDataDir(): string {
  return path.join(homedir(), "AppData", "Roaming", "workspace-orchestrator");
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

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { statePathIn } from "./paths";
import type { IconTheme, RunRecord, RunStatus } from "../shared/types";

export type PersistState = {
  version: 1;
  schedulerEnabled: boolean;
  iconTheme: IconTheme;
  keyed: Record<string, { runId: string; status: RunStatus }>;
  runs: RunRecord[];
};

const EMPTY: PersistState = {
  version: 1,
  schedulerEnabled: false,
  iconTheme: "light",
  keyed: {},
  runs: [],
};

export class Store {
  private readonly file: string;
  data: PersistState;

  constructor(dataDir: string) {
    this.file = statePathIn(dataDir);
    this.data = this.read();
  }

  runKey(workspaceId: string, scheduleId: string, localDate: string): string {
    return `${workspaceId}|${scheduleId}|${localDate}`;
  }

  upsertRun(run: RunRecord, persistKey: boolean): void {
    const index = this.data.runs.findIndex((item) => item.runId === run.runId);
    if (index >= 0) {
      this.data.runs[index] = run;
    } else {
      this.data.runs.unshift(run);
      this.data.runs = this.data.runs.slice(0, 200);
    }
    if (persistKey && run.trigger !== "manual") {
      this.data.keyed[this.runKey(run.workspaceId, run.scheduleId, run.keyedTail ?? run.localDate)] = {
        runId: run.runId,
        status: run.status,
      };
      this.pruneKeyed();
    }
    this.flush();
  }

  private pruneKeyed(): void {
    const alive = new Set(this.data.runs.map((run) => run.runId));
    for (const [key, value] of Object.entries(this.data.keyed)) {
      if (!alive.has(value.runId)) {
        delete this.data.keyed[key];
      }
    }
  }

  markStaleRunning(): void {
    let changed = false;
    for (const run of this.data.runs) {
      if (run.status === "running" || run.status === "queued") {
        run.status = "failed";
        run.finishedAt = new Date().toISOString();
        run.steps = run.steps.map((step) =>
          step.status === "running" || step.status === "queued" || step.status === "pending"
            ? { ...step, status: "failed", error: "进程异常退出", finishedAt: run.finishedAt }
            : step,
        );
        if (run.trigger !== "manual") {
          this.data.keyed[this.runKey(run.workspaceId, run.scheduleId, run.keyedTail ?? run.localDate)] = {
            runId: run.runId,
            status: "failed",
          };
        }
        changed = true;
      }
    }
    if (changed) {
      this.flush();
    }
  }

  private read(): PersistState {
    if (!existsSync(this.file)) {
      return structuredClone(EMPTY);
    }
    try {
      const parsed = JSON.parse(readFileSync(this.file, "utf8")) as PersistState;
      if (parsed.version !== 1) {
        return structuredClone(EMPTY);
      }
      parsed.keyed ??= {};
      parsed.runs ??= [];
      parsed.schedulerEnabled ??= false;
      parsed.iconTheme = parsed.iconTheme === "dark" ? "dark" : "light";
      return parsed;
    } catch {
      return structuredClone(EMPTY);
    }
  }

  flush(): void {
    mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.data, null, 2), "utf8");
    renameSync(tmp, this.file);
  }
}

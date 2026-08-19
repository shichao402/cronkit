import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { RunRecord, RunStatus, Snapshot, StepRecord, Trigger } from "../shared/types";
import { loadConfig, stepWorkingPath, type AppConfig, type Step, type Workspace } from "./config";
import { TypedEmitter } from "./events";
import { logsDirIn, normalizePathKey } from "./paths";
import { buildPlan, previousFire } from "./plan";
import { runScriptStep } from "./script";
import { Store } from "./store";
import { svnCheckAndUpdate } from "./svn";
import { addDays, localDate, nowIso, parseTimeout } from "./time";
import { warmupUnity } from "./unity";
import { releaseOccupants } from "./occupants";

type Job = {
  run: RunRecord;
  workspace: Workspace;
  persistKey: boolean;
  abort: AbortController;
  resolve: (run: RunRecord) => void;
};

export class Orchestrator extends TypedEmitter {
  config!: AppConfig;
  configPath: string;
  configError?: string;
  readonly dataDir: string;
  readonly store: Store;
  private readonly queue: Job[] = [];
  private readonly jobs = new Map<string, Job>();
  private readonly pathLocks = new Set<string>();
  private timer?: NodeJS.Timeout;
  openAtLogin = false;

  constructor(options: { configPath: string; dataDir: string }) {
    super();
    this.configPath = options.configPath;
    this.dataDir = options.dataDir;
    this.store = new Store(options.dataDir);
    this.reloadConfig();
    this.store.markStaleRunning();
  }

  reloadConfig(): void {
    try {
      this.config = loadConfig(this.configPath);
      this.configError = undefined;
    } catch (error) {
      this.configError = error instanceof Error ? error.message : String(error);
    }
    this.emitChange();
  }

  start(): void {
    if (this.timer) {
      return;
    }
    this.timer = setInterval(() => this.tick(false), 20_000);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  setSchedulerEnabled(enabled: boolean): void {
    this.store.data.schedulerEnabled = enabled;
    this.store.flush();
    this.emitChange();
  }

  snapshot(): Snapshot {
    const plan = this.config ? buildPlan(this.config) : [];
    const runningIds = new Set(
      this.store.data.runs.filter((run) => run.status === "running" || run.status === "queued").map((r) => r.workspaceId),
    );
    const hasFailed = this.store.data.runs.some(
      (run) => run.status === "failed" && run.localDate === (this.config ? localDate(this.config.timezone) : ""),
    );
    const appState = runningIds.size > 0 ? "running" : hasFailed ? "failed" : "idle";

    return {
      configPath: this.configPath,
      dataDir: this.dataDir,
      configError: this.configError,
      timezone: this.config?.timezone ?? "Asia/Shanghai",
      appState,
      schedulerEnabled: this.store.data.schedulerEnabled,
      openAtLogin: this.openAtLogin,
      workspaces: plan.map((item) => {
        const lastRun = this.store.data.runs.find((run) => run.workspaceId === item.workspaceId);
        return {
          id: item.workspaceId,
          name: item.workspaceName,
          path: item.path,
          autoScheduled: item.autoScheduled,
          scheduleId: item.scheduleId,
          cron: item.cron,
          nextRun: item.nextRun,
          lastRun,
          running: runningIds.has(item.workspaceId),
          steps: item.steps,
        };
      }),
      runs: this.store.data.runs.slice(0, 40),
    };
  }

  async runWorkspace(workspaceId: string, trigger: Trigger, scheduleId = "manual"): Promise<RunRecord> {
    if (!this.config || this.configError) {
      throw new Error(this.configError ?? "配置未加载");
    }
    const workspace = this.config.workspaces.find((item) => item.id === workspaceId);
    if (!workspace) {
      throw new Error(`未知 workspace: ${workspaceId}`);
    }

    const date = localDate(this.config.timezone);
    const persistKey = trigger !== "manual";
    if (persistKey) {
      const existing = this.store.data.keyed[this.store.runKey(workspaceId, scheduleId, date)];
      if (existing) {
        const inFlight = existing.status === "queued" || existing.status === "running";
        const doneOk = existing.status === "succeeded" || existing.status === "skipped";
        const blockedFail =
          (existing.status === "failed" || existing.status === "cancelled") &&
          !this.config.runtime.retryFailedOnCatchUp;
        if (inFlight || doneOk || blockedFail) {
          const found = this.store.data.runs.find((run) => run.runId === existing.runId);
          if (found) {
            return found;
          }
        }
      }
    }

    const run: RunRecord = {
      runId: randomUUID(),
      workspaceId,
      workspaceName: workspace.name,
      scheduleId,
      localDate: date,
      trigger,
      status: "queued",
      startedAt: nowIso(),
      steps: workspace.steps.map((step, index) => ({
        index,
        type: step.type,
        status: "pending",
        summary: stepSummary(step),
      })),
    };

    return new Promise<RunRecord>((resolve) => {
      const job: Job = {
        run,
        workspace,
        persistKey,
        abort: new AbortController(),
        resolve,
      };
      this.queue.push(job);
      this.jobs.set(run.runId, job);
      this.store.upsertRun(run, persistKey);
      this.emitChange();
      this.pump();
    });
  }

  cancelRun(runId: string): void {
    const queued = this.queue.findIndex((job) => job.run.runId === runId);
    if (queued >= 0) {
      const [job] = this.queue.splice(queued, 1);
      this.finish(job, "cancelled", "用户取消");
      return;
    }
    const job = this.jobs.get(runId);
    if (job) {
      job.abort.abort();
    }
  }

  catchUpNow(): void {
    this.tick(true);
  }

  private tick(forceCatchUp = false): void {
    if (!this.config || this.configError) {
      return;
    }
    if (!forceCatchUp && !this.store.data.schedulerEnabled) {
      return;
    }
    const today = localDate(this.config.timezone);
    const oldest = addDays(today, -this.config.runtime.catchUpPreviousDays);
    const onTimeWindowMs = 3 * 60_000;
    for (const schedule of this.config.schedules) {
      const prev = previousFire(schedule.cron, this.config.timezone);
      if (!prev) {
        continue;
      }
      const fireDate = localDate(this.config.timezone, prev);
      if (fireDate < oldest || fireDate > today) {
        continue;
      }
      if (prev.getTime() > Date.now()) {
        continue;
      }
      const age = Date.now() - prev.getTime();
      if (!forceCatchUp && age > onTimeWindowMs) {
        continue;
      }
      const trigger: Trigger = age < onTimeWindowMs ? "schedule" : "catch-up";
      for (const workspaceId of schedule.workspaceIds) {
        void this.runWorkspace(workspaceId, trigger, schedule.id).catch(() => undefined);
      }
    }
  }

  private pump(): void {
    if (!this.config) {
      return;
    }
    const running = [...this.jobs.values()].filter((job) => job.run.status === "running").length;
    const room = this.config.runtime.maxConcurrentRuns - running;
    if (room <= 0) {
      return;
    }
    const index = this.queue.findIndex((job) => !this.pathLocks.has(normalizePathKey(job.workspace.path)));
    if (index < 0) {
      return;
    }
    const [job] = this.queue.splice(index, 1);
    void this.execute(job).finally(() => this.pump());
  }

  private async execute(job: Job): Promise<void> {
    const pathKey = normalizePathKey(job.workspace.path);
    this.pathLocks.add(pathKey);
    job.run.status = "running";
    job.run.startedAt = nowIso();
    this.store.upsertRun(job.run, job.persistKey);
    this.emitChange();

    try {
        if (this.config.runtime.releaseOccupants !== false) {
        const released = await releaseOccupants({
          target: job.workspace.path,
          graceMs: this.config.runtime.releaseGraceMs,
          abortSignal: job.abort.signal,
        });
        const logDir = logsDirIn(this.dataDir, job.run.localDate, job.run.runId);
        mkdirSync(logDir, { recursive: true });
        writeFileSync(
          path.join(logDir, "occupants.log"),
          released.closed.length === 0
            ? "无占用进程\n"
            : `已结束占用进程:\n${released.closed.map((item) => `${item.name} pid=${item.pid} [${item.source}]`).join("\n")}\n`,
          "utf8",
        );
        if (released.remaining.length > 0) {
          const names = released.remaining.map((item) => `${item.name}(${item.pid})`).join(", ");
          throw new Error(`无法释放目录占用: ${names}`);
        }
      }
      for (let i = 0; i < job.workspace.steps.length; i += 1) {
        if (job.abort.signal.aborted) {
          this.finish(job, "cancelled", "用户取消");
          return;
        }
        const step = job.workspace.steps[i];
        const record = job.run.steps[i];
        const skipSvn =
          step.type === "svn-update" &&
          (step.strategy === "disabled" || (step.strategy === "manual" && job.run.trigger !== "manual"));

        record.status = skipSvn ? "skipped" : "running";
        record.startedAt = nowIso();
        this.store.upsertRun(job.run, job.persistKey);
        this.emitChange();

        if (skipSvn) {
          record.finishedAt = nowIso();
          record.error = undefined;
          continue;
        }

        const attempts = (step.retry ?? 0) + 1;
        let lastError: unknown;
        for (let attempt = 0; attempt < attempts; attempt += 1) {
          try {
            await this.runStep(job, step, record);
            lastError = undefined;
            break;
          } catch (error) {
            lastError = error;
            if (job.abort.signal.aborted) {
              break;
            }
          }
        }

        record.finishedAt = nowIso();
        if (job.abort.signal.aborted) {
          record.status = "cancelled";
          this.finish(job, "cancelled", "用户取消");
          return;
        }
        if (lastError) {
          record.status = "failed";
          record.error = lastError instanceof Error ? lastError.message : String(lastError);
          this.store.upsertRun(job.run, job.persistKey);
          this.emitChange();
          if (!step.continueOnError) {
            this.finish(job, "failed", record.error);
            return;
          }
        } else {
          record.status = "succeeded";
        }
        this.store.upsertRun(job.run, job.persistKey);
        this.emitChange();
      }
      const failed = job.run.steps.some((step) => step.status === "failed");
      this.finish(job, failed ? "failed" : "succeeded");
    } catch (error) {
      this.finish(job, "failed", error instanceof Error ? error.message : String(error));
    } finally {
      this.pathLocks.delete(pathKey);
    }
  }

  private async runStep(job: Job, step: Step, record: StepRecord): Promise<void> {
    const cwd = stepWorkingPath(job.workspace, step);
    const logDir = logsDirIn(this.dataDir, job.run.localDate, job.run.runId);
    mkdirSync(logDir, { recursive: true });
    const logFile = path.join(logDir, `step-${String(record.index).padStart(2, "0")}-${step.type}.log`);
    record.logFile = logFile;
    const timeoutMs = parseTimeout(step.timeout);

    if (step.type === "svn-update") {
      const result = await svnCheckAndUpdate({
        workingCopy: cwd,
        timeoutMs,
        logFile,
        abortSignal: job.abort.signal,
        skipUpdate: false,
        onConflict: step.onConflict,
        backupOnRevert: step.backupOnRevert,
        backupDir: step.backupDir,
        localDate: job.run.localDate,
      });
      record.exitCode = result.code;
      record.outputTail = result.detail;
      return;
    }

    if (step.type === "unity-warmup") {
      const spawnLog = `${logFile}.spawn.log`;
      const result = await warmupUnity({
        projectPath: cwd,
        timeoutMs,
        logFile,
        abortSignal: job.abort.signal,
        nographics: step.nographics,
        executeMethod: step.executeMethod,
      });
      record.exitCode = result.code;
      record.outputTail = result.detail;
      if (!existsSync(logFile) && existsSync(spawnLog)) {
        record.logFile = spawnLog;
      }
      return;
    }

    const result = await runScriptStep({
      cwd,
      command: step.command,
      args: step.args,
      timeoutMs,
      logFile,
      abortSignal: job.abort.signal,
    });
    record.exitCode = result.code;
    record.outputTail = result.detail;
  }

  private finish(job: Job, status: RunStatus, error?: string): void {
    job.run.status = status;
    job.run.finishedAt = nowIso();
    if (error && status !== "succeeded") {
      for (const step of job.run.steps) {
        if (step.status === "pending" || step.status === "running") {
          step.status = status === "cancelled" ? "cancelled" : "skipped";
          step.error = error;
          step.finishedAt = job.run.finishedAt;
        }
      }
    }
    this.jobs.delete(job.run.runId);
    this.store.upsertRun(job.run, job.persistKey);
    this.emit("runFinished", job.run);
    this.emitChange();
    job.resolve(job.run);
  }
}

function stepSummary(step: Step): string {
  if (step.type === "svn-update") {
    return `svn-update (${step.strategy})`;
  }
  if (step.type === "unity-warmup") {
    return step.path ? `unity-warmup (${step.path})` : "unity-warmup";
  }
  return `script ${step.command}`;
}

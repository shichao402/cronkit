import { randomUUID } from "node:crypto";
import { appendFileSync, copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type {
  ConfigEditorPayload,
  EditorDraft,
  IconTheme,
  RunRecord,
  RunStatus,
  Snapshot,
  StepRecord,
  Trigger,
} from "../shared/types";
import {
  loadConfig,
  parseConfigFromText,
  readConfigText,
  stepWorkingPath,
  toInvocation,
  type AppConfig,
  type Workspace,
} from "./config";
import { configToDraft, draftToYaml } from "./config-draft";
import { TypedEmitter } from "./events";
import { logsDirIn, normalizePathKey } from "./paths";
import { buildPlan, previousFire } from "./plan";
import { Store } from "./store";
import { addDays, displayTime, localDate, nowIso, parseTimeout } from "./time";
import { prepareExclusiveAccess } from "./occupants";
import {
  listInstalledToolsets,
  lookupTool,
  runToolInvocation,
  summarizeInvocation,
  type ToolInvocation,
} from "./toolset";

type Job = {
  run: RunRecord;
  workspace: Workspace;
  persistKey: boolean;
  keyedTail: string;
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
    this.eventLog(`程序初始化 schedulerEnabled=${this.store.data.schedulerEnabled}`);
  }

  reloadConfig(): void {
    try {
      this.config = loadConfig(this.configPath, this.dataDir);
      this.configError = undefined;
      this.eventLog(
        `配置加载成功 schedules=${this.config.schedules.length} workspaces=${this.config.workspaces.length}`,
      );
    } catch (error) {
      this.configError = error instanceof Error ? error.message : String(error);
      this.eventLog(`配置加载失败: ${this.configError}`);
    }
    this.emitChange();
  }

  getConfigEditor(): ConfigEditorPayload {
    const text = readConfigText(this.configPath);
    const toolsets = listInstalledToolsets(this.dataDir);
    try {
      const config = parseConfigFromText(text, this.configPath, this.dataDir, { resolvePaths: false });
      return {
        path: this.configPath,
        text,
        draft: configToDraft(config),
        toolsets,
      };
    } catch (error) {
      return {
        path: this.configPath,
        text,
        parseError: error instanceof Error ? error.message : String(error),
        toolsets,
      };
    }
  }

  validateConfigText(text: string): { ok: boolean; error?: string } {
    try {
      parseConfigFromText(text, this.configPath, this.dataDir, { resolvePaths: false });
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  saveConfigText(text: string): Snapshot {
    const checked = this.validateConfigText(text);
    if (!checked.ok) {
      throw new Error(checked.error ?? "配置无效");
    }
    if (existsSync(this.configPath)) {
      copyFileSync(this.configPath, `${this.configPath}.bak`);
    }
    writeFileSync(this.configPath, text.endsWith("\n") ? text : `${text}\n`, "utf8");
    this.reloadConfig();
    if (this.configError) {
      throw new Error(this.configError);
    }
    return this.snapshot();
  }

  saveConfigDraft(draft: EditorDraft): Snapshot {
    return this.saveConfigText(draftToYaml(draft));
  }

  start(): void {
    if (this.timer) {
      return;
    }
    this.timer = setInterval(() => this.tick(false), 20_000);
    this.timer.unref?.();
    this.eventLog("调度器已启动");
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
    this.eventLog(`自动调度已${enabled ? "启用" : "停用"}`);
    this.emitChange();
  }

  setIconTheme(theme: IconTheme): void {
    this.store.data.iconTheme = theme;
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
    const runningCount = [...this.jobs.values()].filter((job) => job.run.status === "running").length;

    return {
      configPath: this.configPath,
      dataDir: this.dataDir,
      configError: this.configError,
      timezone: this.config?.timezone ?? "Asia/Shanghai",
      appState,
      schedulerEnabled: this.store.data.schedulerEnabled,
      openAtLogin: this.openAtLogin,
      iconTheme: this.store.data.iconTheme,
      exitWarnsRunning: runningCount > 0,
      toolsets: listInstalledToolsets(this.dataDir),
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

  async runWorkspace(
    workspaceId: string,
    trigger: Trigger,
    scheduleId = "manual",
    slotKey?: string,
  ): Promise<RunRecord> {
    if (!this.config || this.configError) {
      throw new Error(this.configError ?? "配置未加载");
    }
    const workspace = this.config.workspaces.find((item) => item.id === workspaceId);
    if (!workspace) {
      throw new Error(`未知 workspace: ${workspaceId}`);
    }

    const date = localDate(this.config.timezone);
    const keyedTail = workspace.oncePerDay === false && slotKey ? slotKey : date;
    const persistKey = trigger !== "manual";
    if (persistKey) {
      const existing = this.store.data.keyed[this.store.runKey(workspaceId, scheduleId, keyedTail)];
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
      keyedTail,
      trigger,
      status: "queued",
      startedAt: nowIso(),
      steps: workspace.steps.map((step, index) => {
        const inv = toInvocation(step);
        return {
          index,
          type: `${inv.toolsetId}/${inv.tool}`,
          status: "pending" as const,
          summary: summarizeInvocation(inv),
        };
      }),
    };

    return new Promise<RunRecord>((resolve) => {
      const job: Job = {
        run,
        workspace,
        persistKey,
        keyedTail,
        abort: new AbortController(),
        resolve,
      };
      this.queue.push(job);
      this.jobs.set(run.runId, job);
      this.store.upsertRun(run, persistKey);
      this.eventLog(
        `任务入队 workspace=${workspaceId} trigger=${trigger} schedule=${scheduleId} slot=${keyedTail} runId=${run.runId}`,
      );
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
      const slotKey = prev.toISOString();
      for (const workspaceId of schedule.workspaceIds) {
        void this.runWorkspace(workspaceId, trigger, schedule.id, slotKey).catch((error) => {
          this.eventLog(
            `调度入队失败 workspace=${workspaceId}: ${error instanceof Error ? error.message : String(error)}`,
          );
        });
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
    this.runLog(job, `任务开始 trigger=${job.run.trigger} schedule=${job.run.scheduleId}`);
    this.emitChange();

    try {
      const invocations = job.workspace.steps.map((step) => toInvocation(step));
      const needsExclusive = invocations.some((inv) => {
        const tool = lookupTool(inv.toolsetId, inv.tool, this.dataDir);
        return tool?.requiresExclusiveWorkspace === true;
      });
      if (needsExclusive) {
        await this.ensureExclusive(job, "run-start");
      }
      for (let i = 0; i < job.workspace.steps.length; i += 1) {
        if (job.abort.signal.aborted) {
          this.finish(job, "cancelled", "用户取消");
          return;
        }
        const step = job.workspace.steps[i];
        const inv = invocations[i];
        const record = job.run.steps[i];
        const skipSvn =
          inv.tool === "svn-update" &&
          (inv.params.strategy === "disabled" ||
            (inv.params.strategy === "manual" && job.run.trigger !== "manual"));

        record.status = skipSvn ? "skipped" : "running";
        record.startedAt = nowIso();
        this.runLog(job, `步骤开始 #${i} ${record.summary}`);
        this.store.upsertRun(job.run, job.persistKey);
        this.emitChange();

        if (skipSvn) {
          record.finishedAt = nowIso();
          record.error = undefined;
          record.outputTail = "按当前 strategy/触发方式跳过";
          this.runLog(job, `步骤跳过 #${i}: ${record.outputTail}`);
          continue;
        }

        const attempts = stepAttempts(inv, this.dataDir);
        const toolMeta = lookupTool(inv.toolsetId, inv.tool, this.dataDir);
        if (toolMeta?.idempotent === false && (inv.retry ?? 0) > 0) {
          this.runLog(
            job,
            `步骤 #${i} 工具非幂等，忽略 retry=${inv.retry}，仅执行 1 次`,
          );
        }
        let lastError: unknown;
        for (let attempt = 0; attempt < attempts; attempt += 1) {
          try {
            const tool = lookupTool(inv.toolsetId, inv.tool, this.dataDir);
            if (tool?.requiresExclusiveWorkspace) {
              await this.ensureExclusive(job, `${inv.toolsetId}/${inv.tool}#${attempt + 1}`);
            }
            await this.runInvocation(job, inv, record);
            lastError = undefined;
            break;
          } catch (error) {
            lastError = error;
            this.runLog(
              job,
              `步骤尝试失败 #${i} attempt=${attempt + 1}/${attempts}: ${
                error instanceof Error ? error.message : String(error)
              }`,
            );
            if (job.abort.signal.aborted) {
              break;
            }
            if (attempt + 1 < attempts) {
              this.runLog(job, `步骤将在 3 秒后重试 #${i}`);
              await delay(3_000, job.abort.signal);
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
          if (!inv.continueOnError) {
            this.finish(job, "failed", record.error);
            return;
          }
        } else if (record.status !== "skipped") {
          record.status = "succeeded";
        }
        this.runLog(
          job,
          `步骤结束 #${i} status=${record.status}${record.outputTail ? ` detail=${singleLine(record.outputTail)}` : ""}`,
        );
        this.store.upsertRun(job.run, job.persistKey);
        this.emitChange();
      }
      const failed = job.run.steps.some((step) => step.status === "failed");
      const allSkipped = job.run.steps.every((step) => step.status === "skipped");
      this.finish(job, failed ? "failed" : allSkipped ? "skipped" : "succeeded");
    } catch (error) {
      this.finish(job, "failed", error instanceof Error ? error.message : String(error));
    } finally {
      this.pathLocks.delete(pathKey);
    }
  }

  private async ensureExclusive(job: Job, label: string): Promise<void> {
    if (this.config.runtime.releaseOccupants === false) {
      return;
    }
    const prepared = await prepareExclusiveAccess({
      target: job.workspace.path,
      graceMs: this.config.runtime.releaseGraceMs,
      abortSignal: job.abort.signal,
    });
    const logDir = logsDirIn(this.dataDir, job.run.localDate, job.run.runId);
    mkdirSync(logDir, { recursive: true });
    const lines = [`[${nowIso()}] ${label}`];
    if (prepared.closed.length === 0) {
      lines.push("无占用进程");
    } else {
      lines.push("已结束占用进程:");
      for (const item of prepared.closed) {
        lines.push(`  ${item.name} pid=${item.pid} [${item.source}]`);
      }
    }
    if (prepared.remainingLocks.length > 0) {
      lines.push(`残留 Unity 锁: ${prepared.remainingLocks.join(", ")}`);
    }
    appendFileSync(path.join(logDir, "occupants.log"), `${lines.join("\n")}\n\n`, "utf8");
    if (prepared.remaining.length > 0) {
      const names = prepared.remaining.map((item) => `${item.name}(${item.pid})`).join(", ");
      throw new Error(`无法释放目录占用: ${names}`);
    }
    if (prepared.remainingLocks.length > 0) {
      throw new Error(`无法释放 Unity 项目锁: ${prepared.remainingLocks.join(", ")}`);
    }
  }

  private async runInvocation(job: Job, inv: ToolInvocation, record: StepRecord): Promise<void> {
    const cwd = stepWorkingPath(job.workspace, inv);
    const logDir = logsDirIn(this.dataDir, job.run.localDate, job.run.runId);
    mkdirSync(logDir, { recursive: true });
    const logFile = path.join(
      logDir,
      `step-${String(record.index).padStart(2, "0")}-${inv.toolsetId}-${inv.tool}.log`,
    );
    record.logFile = logFile;
    const timeoutMs = parseTimeout(inv.timeout);
    const resultJsonPath = `${logFile}.result.json`;

    const result = await runToolInvocation(
      inv,
      {
        cwd,
        timeoutMs,
        logFile,
        abortSignal: job.abort.signal,
        resultJsonPath,
        localDate: job.run.localDate,
        workspacePath: job.workspace.path,
      },
      this.dataDir,
    );
    record.exitCode = result.code;
    if (existsSync(resultJsonPath)) {
      try {
        const parsed = JSON.parse(readFileSync(resultJsonPath, "utf8")) as {
          summary?: string;
          detail?: string;
        };
        record.outputTail = parsed.summary || parsed.detail || result.detail;
      } catch {
        record.outputTail = result.detail;
      }
    } else {
      record.outputTail = result.detail;
    }
    if (result.skipped) {
      record.status = "skipped";
    }
    if (!existsSync(logFile) && existsSync(`${logFile}.spawn.log`)) {
      record.logFile = `${logFile}.spawn.log`;
    }
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
    this.runLog(job, `任务结束 status=${status}${error ? ` error=${singleLine(error)}` : ""}`);
    this.writeRunSummary(job);
    this.eventLog(
      `任务结束 workspace=${job.run.workspaceId} status=${status} runId=${job.run.runId}`,
    );
    this.emit("runFinished", job.run);
    this.emitChange();
    job.resolve(job.run);
  }

  private eventLog(message: string): void {
    const date = this.config ? localDate(this.config.timezone) : new Date().toISOString().slice(0, 10);
    const dir = path.join(this.dataDir, "logs", date);
    mkdirSync(dir, { recursive: true });
    appendFileSync(
      path.join(dir, "scheduler.log"),
      `[${displayTime(undefined, this.config?.timezone)}] ${message}\n`,
      "utf8",
    );
  }

  private runLog(job: Job, message: string): void {
    const dir = logsDirIn(this.dataDir, job.run.localDate, job.run.runId);
    mkdirSync(dir, { recursive: true });
    appendFileSync(
      path.join(dir, "run.log"),
      `[${displayTime(undefined, this.config?.timezone)}] ${message}\n`,
      "utf8",
    );
  }

  private writeRunSummary(job: Job): void {
    const dir = logsDirIn(this.dataDir, job.run.localDate, job.run.runId);
    mkdirSync(dir, { recursive: true });
    const lines = [
      `任务: ${job.run.workspaceName} (${job.run.workspaceId})`,
      `结果: ${job.run.status}`,
      `触发: ${job.run.trigger} / ${job.run.scheduleId}`,
      `开始: ${displayTime(job.run.startedAt, this.config?.timezone)}`,
      `结束: ${job.run.finishedAt ? displayTime(job.run.finishedAt, this.config?.timezone) : "-"}`,
      `Run ID: ${job.run.runId}`,
      "",
      ...job.run.steps.flatMap((step) => [
        `步骤 ${step.index + 1}: ${step.summary}`,
        `  状态: ${step.status}`,
        `  开始: ${step.startedAt ? displayTime(step.startedAt, this.config?.timezone) : "-"}`,
        `  结束: ${step.finishedAt ? displayTime(step.finishedAt, this.config?.timezone) : "-"}`,
        `  结果: ${step.outputTail ? singleLine(step.outputTail) : "-"}`,
        `  错误: ${step.error ? singleLine(step.error) : "-"}`,
        `  日志: ${step.logFile ?? "-"}`,
        "",
      ]),
    ];
    appendFileSync(path.join(dir, "summary.txt"), `${lines.join("\n")}\n`, "utf8");
  }
}

function stepAttempts(inv: ToolInvocation, dataDir: string): number {
  const tool = lookupTool(inv.toolsetId, inv.tool, dataDir);
  if (tool && tool.idempotent === false) {
    if ((inv.retry ?? 0) > 0) {
      // Non-idempotent tools never auto-retry; logged by caller via attempts=1.
    }
    return 1;
  }
  const fallback =
    inv.tool === "svn-update" || inv.tool === "unity-warmup" ? 1 : 0;
  return (inv.retry ?? fallback) + 1;
}

function singleLine(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
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

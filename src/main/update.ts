/**
 * Electron 侧的更新服务。
 *
 * 分工（守 ADR 0002 / 0012）：`src/core/update/` 放纯逻辑与 sidecar facade，
 * 本文件负责对话框、托盘、IPC 广播。check / download / apply 全部经
 * relkit-updater sidecar。
 */

import { app, dialog, Notification, shell } from "electron";
import { existsSync } from "node:fs";
import { timestampDate } from "@bufbuild/protobuf/wkt";
import type { CheckResult, UpdateAvailable } from "@relkit/updater-bindings/updater/v1";
import { SessionPhase } from "@relkit/updater-bindings/updater/v1";
import { resolveInstallDir, updaterPath } from "../core/update/apply";
import { CheckLoop } from "../core/update/check-loop";
import { CURRENT_VERSION_LABEL } from "../core/update/config";
import { buildClientProfile, buildRuntime } from "../core/update/profile";
import { Updater } from "../core/update/sidecar";
import {
  initialStatus,
  installBlockedReason,
  type UpdateStatus,
  type UpdateTargetInfo,
} from "../core/update/status";

const PROGRESS_THROTTLE_MS = 400;

export type UpdateServiceOptions = {
  dataDir: string;
  onChange: (status: UpdateStatus) => void;
  hasRunningTasks: () => boolean;
  prepareToQuit: () => void;
  log?: (message: string) => void;
};

export class UpdateService {
  private readonly options: UpdateServiceOptions;
  private readonly enabled: boolean;
  private updater: Updater | null = null;
  private loop: CheckLoop | null = null;
  private status: UpdateStatus;
  private planId: string | null = null;
  private lastProgressAt = 0;
  private inflight: Promise<UpdateStatus> | null = null;

  constructor(options: UpdateServiceOptions) {
    this.options = options;
    this.enabled = app.isPackaged;
    this.status = initialStatus(CURRENT_VERSION_LABEL, this.enabled);
  }

  snapshot(): UpdateStatus {
    return this.status;
  }

  async start(): Promise<void> {
    if (!this.enabled) {
      this.log("开发态，跳过更新检查");
      return;
    }
    const opened = await this.openUpdater();
    if (!opened) {
      return;
    }
    await this.restoreSession();
    this.loop = new CheckLoop(opened, undefined, (event) => {
      if (event.kind === "result" && event.result) {
        this.applyCheck(event.result);
        this.notifyIfWorthwhile(event.result);
      }
    });
    this.loop.start({ checkOnStart: true, forceOnStart: false });
  }

  stop(): void {
    this.loop?.stop();
    this.loop = null;
    this.updater = null;
  }

  async check(force = true): Promise<UpdateStatus> {
    if (!this.enabled) {
      return this.status;
    }
    if (this.inflight) {
      return this.inflight;
    }
    const task = (async () => {
      const updater = await this.ensureUpdater();
      if (!updater) {
        return this.status;
      }
      this.patch({ phase: "checking", message: undefined, attempts: undefined });
      const result = await updater.check({ force });
      this.applyCheck(result);
      this.notifyIfWorthwhile(result);
      return this.status;
    })().finally(() => {
      this.inflight = null;
    });
    this.inflight = task;
    return task;
  }

  async download(): Promise<UpdateStatus> {
    const updater = this.updater;
    const planId = this.planId;
    if (!updater || !planId) {
      this.patch({ message: "没有待下载的更新" });
      return this.status;
    }
    if (this.status.phase === "downloading") {
      return this.status;
    }
    this.lastProgressAt = 0;
    this.patch({
      phase: "downloading",
      progress: { receivedBytes: 0, totalBytes: this.status.target?.sizeBytes ?? 0, bytesPerSecond: 0 },
      message: undefined,
    });
    try {
      const result = await updater.download(planId, (event) => {
        if (event.kind.case !== "progress") {
          return;
        }
        const now = Date.now();
        const progress = event.kind.value;
        const received = Number(progress.bytesReceived);
        const total = Number(progress.bytesTotal);
        const done = total > 0 && received >= total;
        if (!done && now - this.lastProgressAt < PROGRESS_THROTTLE_MS) {
          return;
        }
        this.lastProgressAt = now;
        this.patch({
          phase: "downloading",
          progress: {
            receivedBytes: received,
            totalBytes: total,
            bytesPerSecond: Number(progress.bytesPerSecond),
          },
        });
      });
      if (result.kind.case === "downloaded") {
        const downloaded = result.kind.value;
        this.log(`更新已下载并校验通过：plan ${downloaded.planId}`);
        this.patch({
          phase: "ready",
          progress: {
            receivedBytes: Number(downloaded.bytes),
            totalBytes: Number(downloaded.bytes),
            bytesPerSecond: 0,
          },
        });
        this.announce("更新已就绪", `${this.status.target?.version ?? ""} 已下载完成，可以安装`);
      } else {
        const why =
          result.kind.case === "failed"
            ? (result.kind.value.error?.message ?? "下载失败")
            : "下载失败";
        this.log(`更新下载失败：${why}`);
        this.patch({ phase: "available", message: why, progress: undefined });
      }
    } catch (error) {
      const why = this.describe(error);
      this.log(`更新下载失败：${why}`);
      this.patch({ phase: "available", message: why, progress: undefined });
    }
    return this.status;
  }

  async skip(): Promise<UpdateStatus> {
    const updater = this.updater;
    const target = this.status.target;
    if (!updater || !target || target.mandatory) {
      return this.status;
    }
    await updater.skip(BigInt(target.code));
    this.planId = null;
    this.patch({
      phase: "current",
      target: undefined,
      progress: undefined,
      downloadedPath: undefined,
      skipped: true,
    });
    return this.status;
  }

  async applyDownloaded(): Promise<{ ok: boolean; canceled?: boolean; error?: string }> {
    const blocked = installBlockedReason(this.status, this.options.hasRunningTasks());
    if (blocked) {
      return { ok: false, error: blocked };
    }
    const updater = this.updater;
    const planId = this.planId;
    const target = this.status.target;
    if (!updater || !planId || !target) {
      return { ok: false, error: "没有已下载的更新" };
    }
    const confirmation = await dialog.showMessageBox({
      type: "question",
      title: "安装更新",
      message: `现在安装 ${target.version}？`,
      detail: "应用会退出并自动重新打开。已完成的下载不会丢失。",
      buttons: ["安装并重启", "取消"],
      defaultId: 0,
      cancelId: 1,
      noLink: true,
    });
    if (confirmation.response !== 0) {
      return { ok: false, canceled: true };
    }
    if (this.options.hasRunningTasks()) {
      return { ok: false, error: "有任务正在运行，等它结束后再安装" };
    }
    this.patch({ phase: "applying", message: undefined });
    try {
      const result = await updater.apply(planId);
      if (result.kind.case === "accepted") {
        this.log(`apply 已接受：session ${result.kind.value.sessionId}`);
        if (result.kind.value.requiresHostExit) {
          this.options.prepareToQuit();
          app.quit();
        }
        return { ok: true };
      }
      const why =
        result.kind.case === "failed"
          ? (result.kind.value.error?.message ?? "安装未被接受")
          : "安装未被接受";
      this.patch({ phase: "ready", message: why });
      return { ok: false, error: why };
    } catch (error) {
      const why = this.describe(error);
      this.log(`启动更新安装失败：${why}`);
      this.patch({ phase: "ready", message: why });
      return { ok: false, error: why };
    }
  }

  async revealDownload(): Promise<{ ok: boolean; error?: string }> {
    const blocked = installBlockedReason(this.status, this.options.hasRunningTasks());
    if (blocked) {
      return { ok: false, error: blocked };
    }
    shell.showItemInFolder(this.options.dataDir);
    return { ok: true };
  }

  async openManualUrl(): Promise<{ ok: boolean; error?: string }> {
    const url = this.status.manualUrl;
    if (!url) {
      return { ok: false, error: "没有手动更新地址" };
    }
    try {
      await shell.openExternal(url);
      return { ok: true };
    } catch (error) {
      return { ok: false, error: this.describe(error) };
    }
  }

  private async openUpdater(): Promise<Updater | null> {
    const installDir = resolveInstallDir(process.execPath);
    const sidecar = updaterPath(installDir);
    if (!existsSync(sidecar)) {
      this.patch({
        phase: "failed",
        message: "安装包缺少 relkit-updater，请重新下载完整安装包",
      });
      this.log(`sidecar 不存在：${sidecar}`);
      return null;
    }
    const opened = await Updater.open(
      buildClientProfile(),
      buildRuntime({
        isPackaged: app.isPackaged,
        executablePath: process.execPath,
        dataDir: this.options.dataDir,
        sidecarPath: sidecar,
      }),
    );
    if (opened.kind === "failed") {
      this.patch({ phase: "failed", message: opened.error.message });
      this.log(`更新服务初始化失败：${opened.error.message}`);
      return null;
    }
    this.updater = opened.updater;
    return opened.updater;
  }

  private async ensureUpdater(): Promise<Updater | null> {
    return this.updater ?? this.openUpdater();
  }

  private async restoreSession(): Promise<void> {
    const updater = this.updater;
    if (!updater) {
      return;
    }
    try {
      const snapshot = await updater.status();
      const session = snapshot.activeSession;
      if (!session) {
        return;
      }
      if (session.phase === SessionPhase.COMPLETED) {
        this.patch({ phase: "current", lastCheckedAt: new Date().toISOString() });
        return;
      }
      if (session.phase === SessionPhase.NEEDS_ATTENTION || session.phase === SessionPhase.ROLLED_BACK) {
        this.patch({
          phase: "failed",
          message: `上次安装更新失败：${session.error?.message || "未知错误"}`,
        });
      }
    } catch (error) {
      this.log(`读取 sidecar 状态失败：${this.describe(error)}`);
    }
  }

  private applyCheck(result: CheckResult): void {
    const now = new Date().toISOString();
    switch (result.kind.case) {
      case "upToDate":
        this.planId = null;
        this.patch({
          phase: "current",
          lastCheckedAt: now,
          target: undefined,
          downloadedPath: undefined,
          progress: undefined,
          message: result.kind.value.currentIsYanked
            ? "当前版本已被发布方撤回，但暂时没有更新的版本可用"
            : undefined,
        });
        break;
      case "updateAvailable": {
        const available = result.kind.value;
        this.planId = available.planId;
        this.patch({
          phase: "available",
          lastCheckedAt: now,
          target: toTargetInfo(available),
          message: undefined,
          progress: undefined,
          downloadedPath: undefined,
          skipped: false,
        });
        break;
      }
      case "throttled": {
        const next = result.kind.value.nextAllowedAt
          ? timestampDate(result.kind.value.nextAllowedAt).toISOString()
          : undefined;
        this.patch({
          phase: this.status.phase === "checking" ? previousPhase(this.status) : this.status.phase,
          nextCheckAt: next,
        });
        break;
      }
      case "failed":
        this.patch({
          phase: "failed",
          lastCheckedAt: now,
          message: result.kind.value.error?.message ?? "检查失败",
          attempts: result.kind.value.error?.attempts,
          progress: undefined,
        });
        break;
      case "fallbackRequired":
        this.planId = null;
        this.patch({
          phase: "manual",
          lastCheckedAt: now,
          message: result.kind.value.message,
          manualUrl: result.kind.value.manualUrl,
          target: undefined,
          progress: undefined,
          downloadedPath: undefined,
        });
        break;
      default:
        break;
    }
  }

  private notifyIfWorthwhile(result: CheckResult): void {
    if (result.kind.case === "updateAvailable") {
      const prefix = result.kind.value.mandatory ? "必须更新" : "有新版本";
      this.announce(prefix, `${result.kind.value.version} 可以下载了`);
      return;
    }
    if (result.kind.case === "fallbackRequired") {
      this.announce("需要手动更新", result.kind.value.message);
    }
  }

  private announce(title: string, body: string): void {
    if (!Notification.isSupported()) {
      return;
    }
    new Notification({ title, body }).show();
  }

  private patch(next: Partial<UpdateStatus>): void {
    this.status = { ...this.status, ...next };
    this.options.onChange(this.status);
  }

  private log(message: string): void {
    this.options.log?.(`[update] ${message}`);
  }

  private describe(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}

function previousPhase(status: UpdateStatus): UpdateStatus["phase"] {
  if (status.phase === "ready" || status.downloadedPath) {
    return "ready";
  }
  return status.target ? "available" : "idle";
}

function toTargetInfo(available: UpdateAvailable): UpdateTargetInfo {
  const artifact = available.artifacts[0];
  return {
    version: available.version,
    code: Number(available.code),
    mandatory: available.mandatory,
    remainingHops: available.remainingHops,
    isFinalHop: available.remainingHops <= 1,
    releaseNotes: available.releaseNotesMarkdown,
    releaseNotesUrl: available.releaseNotesUrl,
    sizeBytes: artifact ? Number(artifact.size) : 0,
  };
}

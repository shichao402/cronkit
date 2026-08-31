/**
 * Electron 侧的更新服务。
 *
 * 分工（守 ADR 0002）：`src/core/update/` 只放纯逻辑，本文件负责所有跟 Electron
 * 相关的部分——状态目录、通知、托盘菜单、IPC 广播。`rup-client` 只在主进程用，
 * 渲染进程通过 IPC 拿状态。
 *
 * 本文件**不含 apply**。`rup-client` 明确不提供 apply，Electron 换自身目录要处理
 * 文件占用、稳定 launcher 路径、单实例锁与开机自启注册，这些都不是协议内容。
 * 首版只做到「下载完成 + 校验通过 + 打开所在目录提示手动安装」，versionedDir
 * 改造单独一批（见 ADR 0010 与接入计划 §3.6）。
 */

import { app, Notification, shell } from "electron";
import { mkdirSync } from "node:fs";
import path from "node:path";
import {
  FileUpdateStateStore,
  RupUpdater,
  UpdateScheduler,
  type UpdateAvailable,
  type UpdateCheckResult,
  type VersionNode,
} from "rup-client";

import {
  CURRENT_VERSION_LABEL,
  UPDATE_CHANNEL,
  UPDATE_CLIENT_SELECTORS,
  UPDATE_ENTRY_URLS,
  UPDATE_PRODUCT,
  UPDATE_TRUSTED_KEYS,
  resolveCurrentCode,
} from "../core/update/config";
import {
  initialStatus,
  installBlockedReason,
  type UpdateStatus,
  type UpdateTargetInfo,
} from "../core/update/status";

/** 进度推送的最小间隔：再密就只是让渲染进程忙着重绘。 */
const PROGRESS_THROTTLE_MS = 400;

export type UpdateServiceOptions = {
  dataDir: string;
  /** 状态变化时回调，用于推给渲染进程。 */
  onChange: (status: UpdateStatus) => void;
  /** 是否有任务正在运行，决定能否提示安装。 */
  hasRunningTasks: () => boolean;
  log?: (message: string) => void;
};

export class UpdateService {
  private readonly options: UpdateServiceOptions;
  private readonly stagingDir: string;
  private readonly enabled: boolean;
  private updater: RupUpdater | null = null;
  private scheduler: UpdateScheduler | null = null;
  private status: UpdateStatus;
  /** 保留最近一次可用更新的原始结果，download 需要它。 */
  private available: UpdateAvailable | null = null;
  private lastProgressAt = 0;
  private inflight: Promise<UpdateStatus> | null = null;

  constructor(options: UpdateServiceOptions) {
    this.options = options;
    this.stagingDir = path.join(options.dataDir, "update-staging");
    // 开发态不检查更新：currentCode 取哨兵值后本就不会有结果，索性连网络都不碰。
    this.enabled = app.isPackaged;
    this.status = initialStatus(CURRENT_VERSION_LABEL, this.enabled);
  }

  snapshot(): UpdateStatus {
    return this.status;
  }

  /** 启动周期检查。开发态直接返回，不建 updater、不发请求。 */
  start(): void {
    if (!this.enabled) {
      this.log("开发态，跳过更新检查");
      return;
    }
    try {
      this.updater = this.buildUpdater();
    } catch (error) {
      // 构造失败几乎只有两种原因：没有内嵌公钥，或入口地址为空。
      // 这两种都是构建配置错误，必须显式暴露而不是静默不更新。
      this.patch({ phase: "failed", message: this.describe(error) });
      this.log(`更新服务初始化失败：${this.describe(error)}`);
      return;
    }
    this.scheduler = new UpdateScheduler({
      check: (options) => this.runCheck(options.force),
      onResult: (result) => this.notifyIfWorthwhile(result),
      log: (message) => this.log(message),
    });
    this.scheduler.start();
  }

  stop(): void {
    this.scheduler?.stop();
    this.scheduler = null;
    this.updater?.close();
    this.updater = null;
  }

  /**
   * 用户主动检查。`force` 绕过节流。
   *
   * 并发调用会复用同一次请求：托盘和设置页可能同时点，重复发请求只会让节流状态
   * 和进度回调互相打断。
   */
  async check(force = true): Promise<UpdateStatus> {
    if (!this.enabled) {
      return this.status;
    }
    if (this.inflight) {
      return this.inflight;
    }
    const task = (async () => {
      const result = await this.runCheck(force);
      this.notifyIfWorthwhile(result);
      return this.status;
    })().finally(() => {
      this.inflight = null;
    });
    this.inflight = task;
    return task;
  }

  /** 下载当前可用的更新，校验通过后转入 ready。 */
  async download(): Promise<UpdateStatus> {
    const updater = this.updater;
    const available = this.available;
    if (!updater || !available) {
      this.patch({ message: "没有待下载的更新" });
      return this.status;
    }
    if (this.status.phase === "downloading") {
      return this.status;
    }

    mkdirSync(this.stagingDir, { recursive: true });
    this.lastProgressAt = 0;
    this.patch({
      phase: "downloading",
      progress: {
        receivedBytes: 0,
        totalBytes: Number(available.artifact.size),
        bytesPerSecond: 0,
      },
      message: undefined,
    });

    try {
      const verified = await updater.download(available, {
        destinationDir: this.stagingDir,
        // SDK 的字段是 received / total（见 rup-client 的 DownloadProgress），
        // 这里转成本项目状态里的 *Bytes 命名，避免渲染层再记两套名字。
        onProgress: (progress) => {
          const now = Date.now();
          const done = progress.total > 0 && progress.received >= progress.total;
          if (!done && now - this.lastProgressAt < PROGRESS_THROTTLE_MS) {
            return;
          }
          this.lastProgressAt = now;
          this.patch({
            phase: "downloading",
            progress: {
              receivedBytes: progress.received,
              totalBytes: progress.total,
              bytesPerSecond: progress.bytesPerSecond,
            },
          });
        },
      });
      this.log(`更新已下载并校验通过：${verified.path}（来源 ${verified.sourceUrl}）`);
      this.patch({
        phase: "ready",
        downloadedPath: verified.path,
        progress: {
          receivedBytes: Number(available.artifact.size),
          totalBytes: Number(available.artifact.size),
          bytesPerSecond: 0,
        },
      });
      this.announce("更新已就绪", `${available.target.version} 已下载完成，可以安装`);
    } catch (error) {
      const why = this.describe(error);
      this.log(`更新下载失败：${why}`);
      // 下载或校验失败后按 SPEC §12.6 查一次紧急通知：可能发布方已经知道这一版
      // 有问题并给了手动地址。
      const fallback = await this.updater?.checkFallback().catch(() => null);
      if (fallback) {
        this.applyResult(fallback);
      } else {
        this.patch({ phase: "available", message: why, progress: undefined });
      }
    }
    return this.status;
  }

  /** 跳过这一版。强制更新不允许跳过。 */
  async skip(): Promise<UpdateStatus> {
    const updater = this.updater;
    const target = this.available?.target;
    if (!updater || !target || this.available?.mandatory) {
      return this.status;
    }
    await updater.skip(target);
    this.available = null;
    this.patch({
      phase: "current",
      target: undefined,
      progress: undefined,
      downloadedPath: undefined,
      skipped: true,
    });
    return this.status;
  }

  /**
   * 「安装」——首版只把用户带到文件所在目录。
   *
   * 真正的目录替换要等 versionedDir 改造。在那之前假装能自动安装反而更危险：
   * 用户以为装好了，实际还在跑旧版。
   */
  async revealDownload(): Promise<{ ok: boolean; error?: string }> {
    const blocked = installBlockedReason(this.status, this.options.hasRunningTasks());
    if (blocked) {
      return { ok: false, error: blocked };
    }
    const target = this.status.downloadedPath;
    if (!target) {
      return { ok: false, error: "没有已下载的文件" };
    }
    shell.showItemInFolder(target);
    return { ok: true };
  }

  /** 打开紧急通知里的手动下载地址。 */
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

  private buildUpdater(): RupUpdater {
    const stateStore = new FileUpdateStateStore({
      directory: this.options.dataDir,
      product: UPDATE_PRODUCT,
      channel: UPDATE_CHANNEL,
    });
    return new RupUpdater({
      product: UPDATE_PRODUCT,
      channel: UPDATE_CHANNEL,
      currentCode: resolveCurrentCode(app.isPackaged),
      trustedKeys: { ...UPDATE_TRUSTED_KEYS },
      clientSelectors: { ...UPDATE_CLIENT_SELECTORS },
      entryUrls: [...UPDATE_ENTRY_URLS],
      stateStore,
      log: (message) => this.log(message),
    });
  }

  private async runCheck(force: boolean): Promise<UpdateCheckResult> {
    const updater = this.updater;
    if (!updater) {
      return { kind: "check-failed", reason: "更新服务未初始化", attempts: [] };
    }
    this.patch({ phase: "checking", message: undefined, attempts: undefined });
    let result: UpdateCheckResult;
    try {
      result = await updater.check({ force });
    } catch (error) {
      result = {
        kind: "check-failed",
        reason: this.describe(error),
        attempts: [],
      };
    }
    this.applyResult(result);
    return result;
  }

  private applyResult(result: UpdateCheckResult): void {
    const now = new Date().toISOString();
    switch (result.kind) {
      case "up-to-date":
        this.available = null;
        this.patch({
          phase: "current",
          lastCheckedAt: now,
          target: undefined,
          downloadedPath: undefined,
          progress: undefined,
          message: result.currentIsYanked
            ? "当前版本已被发布方撤回，但暂时没有更新的版本可用"
            : undefined,
        });
        break;
      case "update-available": {
        this.available = result;
        void this.markSkipped(result);
        this.patch({
          phase: "available",
          lastCheckedAt: now,
          target: toTargetInfo(result),
          message: undefined,
          progress: undefined,
          downloadedPath: undefined,
          skipped: false,
        });
        break;
      }
      case "check-throttled":
        // 节流不是错误，只更新下次可查时间，不覆盖已有阶段。
        this.patch({
          phase: this.status.phase === "checking" ? previousPhase(this.status) : this.status.phase,
          nextCheckAt: result.nextAllowedAt.toISOString(),
        });
        break;
      case "check-failed":
        this.patch({
          phase: "failed",
          lastCheckedAt: now,
          message: result.reason,
          attempts: result.attempts,
          progress: undefined,
        });
        break;
      case "fallback-required":
        // 紧急通知禁止自动下载，只展示并给手动地址。
        this.available = null;
        this.patch({
          phase: "manual",
          lastCheckedAt: now,
          message: result.message,
          manualUrl: result.manualUrl,
          target: undefined,
          progress: undefined,
          downloadedPath: undefined,
        });
        break;
    }
  }

  private async markSkipped(result: UpdateAvailable): Promise<void> {
    const updater = this.updater;
    if (!updater || result.mandatory) {
      return;
    }
    try {
      const skipped = await updater.isSkipped(result.target as VersionNode);
      if (skipped && this.status.phase === "available") {
        this.patch({ skipped: true });
      }
    } catch {
      // 跳过标记查不到不影响主流程。
    }
  }

  /** 只在真正需要用户知道时才弹通知，避免每次周期检查都打扰。 */
  private notifyIfWorthwhile(result: UpdateCheckResult): void {
    if (result.kind === "update-available") {
      const prefix = result.mandatory ? "必须更新" : "有新版本";
      this.announce(prefix, `${result.target.version} 可以下载了`);
      return;
    }
    if (result.kind === "fallback-required") {
      this.announce("需要手动更新", result.message);
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

/**
 * 节流命中时要退回到什么阶段。
 *
 * `checking` 只是过渡态，节流后停在它上面会让 UI 一直转圈。有目标就回 available，
 * 否则回 idle。
 */
function previousPhase(status: UpdateStatus): UpdateStatus["phase"] {
  if (status.downloadedPath) {
    return "ready";
  }
  return status.target ? "available" : "idle";
}

function toTargetInfo(result: UpdateAvailable): UpdateTargetInfo {
  return {
    version: result.target.version,
    code: Number(result.target.code),
    mandatory: result.mandatory,
    remainingHops: result.remainingHops,
    isFinalHop: result.isFinalHop,
    releaseNotes: result.releaseNotesMarkdown,
    releaseNotesUrl: result.releaseNotesUrl,
    sizeBytes: Number(result.artifact.size),
  };
}

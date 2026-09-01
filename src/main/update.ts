/**
 * Electron 侧的更新服务。
 *
 * 分工（守 ADR 0002）：`src/core/update/` 只放纯逻辑，本文件负责所有跟 Electron
 * 相关的部分——状态目录、通知、托盘菜单、IPC 广播。`rup-client` 只在主进程用，
 * 渲染进程通过 IPC 拿状态。
 *
 * apply 由宿主实现：本进程只负责确认、解包和启动等待脚本，真正的目录切换由
 * `relkit-apply` 在本进程退出后执行，避免 Windows 文件锁造成半新半旧。
 */

import { app, dialog, Notification, shell } from "electron";
import { spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import extractZip from "extract-zip";
import {
  FileUpdateStateStore,
  RupUpdater,
  UpdateScheduler,
  type UpdateAvailable,
  type UpdateCheckResult,
  type VersionNode,
} from "rup-client";

import {
  buildApplyArgs,
  parseApplySession,
  resolveInstallDir,
  UPDATE_APPLY_SIDECAR,
  UPDATE_EXECUTABLE,
  versionPayloadDir,
} from "../core/update/apply";
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
  /** sidecar 启动后停止编排器并允许窗口关闭。 */
  prepareToQuit: () => void;
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
    this.restoreApplySession();
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

  /** 解包已校验产物，并在当前进程退出后交给 relkit-apply 原子切换。 */
  async applyDownloaded(): Promise<{ ok: boolean; canceled?: boolean; error?: string }> {
    const blocked = installBlockedReason(this.status, this.options.hasRunningTasks());
    if (blocked) {
      return { ok: false, error: blocked };
    }
    const target = this.status.target;
    const downloadedPath = this.status.downloadedPath;
    if (!target || !downloadedPath) {
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
    const stagedRoot = path.join(this.stagingDir, `apply-${target.code}`);
    try {
      rmSync(stagedRoot, { recursive: true, force: true });
      mkdirSync(stagedRoot, { recursive: true });
      await extractZip(downloadedPath, { dir: stagedRoot });

      const payloadDir = versionPayloadDir(stagedRoot, target.version);
      const sidecar = path.join(stagedRoot, UPDATE_APPLY_SIDECAR);
      const launcher = path.join(stagedRoot, UPDATE_EXECUTABLE);
      const targetExecutable = path.join(payloadDir, UPDATE_EXECUTABLE);
      for (const required of [sidecar, launcher, targetExecutable]) {
        if (!existsSync(required)) {
          throw new Error(`更新包结构不完整：缺少 ${path.relative(stagedRoot, required)}`);
        }
      }

      const installDir = resolveInstallDir(process.execPath);
      const sessionPath = path.join(installDir, "update_apply.json");
      const logPath = path.join(this.options.dataDir, "logs", "update-apply.log");
      const args = buildApplyArgs({
        installDir,
        stagedRoot,
        targetVersion: target.version,
        targetCode: target.code,
        sessionPath,
        logPath,
      });
      const requestPath = path.join(stagedRoot, "apply-request.json");
      const now = new Date().toISOString();
      writeFileSync(
        sessionPath,
        JSON.stringify({
          state: "pending",
          startedAt: now,
          updatedAt: now,
          installDir,
          stagedRoot,
          targetCode: target.code,
          targetVersion: target.version,
        }),
        "utf8",
      );
      writeFileSync(requestPath, JSON.stringify({ sidecar, arguments: args }), "utf8");

      const waitScript = app.isPackaged
        ? path.join(process.resourcesPath, "scripts", "apply-update.ps1")
        : path.join(app.getAppPath(), "scripts", "apply-update.ps1");
      if (!existsSync(waitScript)) {
        throw new Error("找不到更新等待脚本");
      }
      await spawnDetached("powershell", [
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        waitScript,
        "-WaitPid",
        String(process.pid),
        "-RequestPath",
        requestPath,
      ]);
      this.log(`已启动 apply 等待进程：${target.version} -> ${installDir}`);
      this.options.prepareToQuit();
      app.quit();
      return { ok: true };
    } catch (error) {
      const why = this.describe(error);
      this.log(`启动更新安装失败：${why}`);
      this.patch({ phase: "ready", message: why });
      return { ok: false, error: why };
    }
  }

  /**
   * 保留“打开所在目录”作为排障入口；正常安装走 applyDownloaded。
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

  private restoreApplySession(): void {
    if (!app.isPackaged) {
      return;
    }
    const sessionPath = path.join(resolveInstallDir(process.execPath), "update_apply.json");
    if (!existsSync(sessionPath)) {
      return;
    }
    try {
      const session = parseApplySession(JSON.parse(readFileSync(sessionPath, "utf8")));
      if (!session) {
        this.log("忽略格式无效的 apply session");
        return;
      }
      if (session.state === "succeeded") {
        this.status = {
          ...this.status,
          phase: "current",
          lastCheckedAt: session.updatedAt ?? new Date().toISOString(),
        };
        unlinkSync(sessionPath);
        this.log(`更新安装完成：${session.targetVersion}`);
      } else if (session.state === "failed") {
        this.status = {
          ...this.status,
          phase: "failed",
          message: `上次安装更新失败：${session.message || "未知错误"}`,
        };
      } else {
        this.status = {
          ...this.status,
          phase: "failed",
          message: "上次安装更新未完成，请查看更新日志后重试",
        };
      }
    } catch (error) {
      this.log(`读取 apply session 失败：${this.describe(error)}`);
    }
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

function spawnDetached(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });
    child.once("error", reject);
    child.once("spawn", () => {
      child.unref();
      resolve();
    });
  });
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

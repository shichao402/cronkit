/**
 * 更新状态的形状与推导，供主进程与渲染进程共用。
 *
 * 这里只做纯计算：把 SDK 的检查结果映射成 UI 能直接渲染的状态，并集中所有
 * 「什么时候允许下载 / 什么时候允许安装」的判定。刻意不依赖 Electron 与 sidecar
 * 的运行时（只用结构化的入参），因此可以单测。
 */

/** UI 关心的更新阶段。 */
export type UpdatePhase =
  /** 还没查过，或上次查完又过了很久。 */
  | "idle"
  /** 正在查。 */
  | "checking"
  /** 已是最新。 */
  | "current"
  /** 有新版本可下载。 */
  | "available"
  /** 正在下载。 */
  | "downloading"
  /** 已下载并校验通过，等待安装。 */
  | "ready"
  /** 已交给独立 sidecar，主程序即将退出。 */
  | "applying"
  /** 检查失败。 */
  | "failed"
  /** 收到签名的紧急通知，必须让用户手动处理。 */
  | "manual";

export type UpdateProgress = {
  receivedBytes: number;
  totalBytes: number;
  bytesPerSecond: number;
};

export type UpdateTargetInfo = {
  version: string;
  code: number;
  /** 强制更新：宿主不得提供「稍后」。 */
  mandatory: boolean;
  /** 距离最新版还差几跳，>1 说明升级链要求中间版本。 */
  remainingHops: number;
  isFinalHop: boolean;
  releaseNotes: string;
  releaseNotesUrl: string;
  sizeBytes: number;
};

export type UpdateStatus = {
  phase: UpdatePhase;
  /** 当前运行的版本，例如 `0.1.0+1`。 */
  currentVersion: string;
  /** 开发态不检查更新，UI 要据此解释「为何没有更新入口」。 */
  enabled: boolean;
  /** 最近一次检查完成时间（ISO）。 */
  lastCheckedAt?: string;
  /** 节流放开的时间（ISO）。 */
  nextCheckAt?: string;
  target?: UpdateTargetInfo;
  progress?: UpdateProgress;
  /** 已下载并校验通过的文件路径。 */
  downloadedPath?: string;
  /** 失败原因，或紧急通知的正文。 */
  message?: string;
  /** 逐源的尝试记录，排查「服务器挂了」与「服务器拒绝我们」的唯一依据。 */
  attempts?: string[];
  /** 紧急通知里的手动下载地址。 */
  manualUrl?: string;
  /** 该版本已被用户跳过。 */
  skipped?: boolean;
};

export function initialStatus(currentVersion: string, enabled: boolean): UpdateStatus {
  return { phase: "idle", currentVersion, enabled };
}

/** 只有这两个阶段有正在进行的网络动作，UI 据此禁用按钮。 */
export function isBusy(status: UpdateStatus): boolean {
  return (
    status.phase === "checking" ||
    status.phase === "downloading" ||
    status.phase === "applying"
  );
}

/**
 * 是否允许现在安装。
 *
 * cronkit 是托盘常驻程序，装的时候要换掉自身目录，因此必须避开正在跑的编排任务：
 * 任务跑一半被换掉目录，轻则任务失败，重则留下半新半旧的安装。
 */
export function canInstallNow(status: UpdateStatus, hasRunningTasks: boolean): boolean {
  return status.phase === "ready" && !hasRunningTasks;
}

/** 阻止安装的原因，`null` 表示可以装。 */
export function installBlockedReason(
  status: UpdateStatus,
  hasRunningTasks: boolean,
): string | null {
  if (status.phase !== "ready") {
    return "还没有已下载完成的更新";
  }
  if (hasRunningTasks) {
    return "有任务正在运行，等它结束后再安装";
  }
  return null;
}

/** 强制更新时不允许跳过，否则会绕过发布方设的最低版本下限。 */
export function canSkip(status: UpdateStatus): boolean {
  if (status.phase !== "available" && status.phase !== "ready") {
    return false;
  }
  return status.target !== undefined && !status.target.mandatory;
}

/** 下载进度百分比，取整到 0-100；总长未知时返回 0。 */
export function progressPercent(progress: UpdateProgress | undefined): number {
  if (!progress || progress.totalBytes <= 0) {
    return 0;
  }
  const ratio = progress.receivedBytes / progress.totalBytes;
  return Math.max(0, Math.min(100, Math.round(ratio * 100)));
}

/** 人类可读的字节数。UI 与日志共用，避免两处写法不一致。 */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "0 B";
  }
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const digits = unit === 0 ? 0 : value < 10 ? 1 : 0;
  return `${value.toFixed(digits)} ${units[unit]}`;
}

/** 下载速度，`0` 一律显示为空串，避免刚开始时闪出「0 B/s」。 */
export function formatSpeed(bytesPerSecond: number): string {
  if (!Number.isFinite(bytesPerSecond) || bytesPerSecond <= 0) {
    return "";
  }
  return `${formatBytes(bytesPerSecond)}/s`;
}

/**
 * 升级链提示。
 *
 * relkit 允许发布方要求「必须先装中间版本」，这时用户点一次更新只会前进一跳，
 * 不解释的话会以为更新失败了。
 */
export function hopHint(target: UpdateTargetInfo | undefined): string {
  if (!target || target.isFinalHop || target.remainingHops <= 1) {
    return "";
  }
  return `这是升级链上的第一步，装完后还需要 ${target.remainingHops - 1} 次更新才能到最新版`;
}

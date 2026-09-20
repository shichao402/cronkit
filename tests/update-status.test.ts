import { describe, expect, it } from "vitest";
import { resolveInstallDir, UPDATE_EXECUTABLE, UPDATE_SIDECAR, updaterPath } from "../src/core/update/apply";
import {
  canInstallNow,
  canSkip,
  formatBytes,
  formatSpeed,
  hopHint,
  initialStatus,
  installBlockedReason,
  isBusy,
  progressPercent,
  type UpdateStatus,
  type UpdateTargetInfo,
} from "../src/core/update/status";
import { DEV_CURRENT_CODE, resolveCurrentCode } from "../src/core/update/config";
import { APP_VERSION_CODE } from "../src/generated/version";

function target(overrides: Partial<UpdateTargetInfo> = {}): UpdateTargetInfo {
  return {
    version: "0.2.0+4",
    code: 4,
    mandatory: false,
    remainingHops: 1,
    isFinalHop: true,
    requiresFullInstall: false,
    releaseNotes: "",
    releaseNotesUrl: "",
    sizeBytes: 1024,
    ...overrides,
  };
}

function status(overrides: Partial<UpdateStatus> = {}): UpdateStatus {
  return { ...initialStatus("0.1.0+1", true), ...overrides };
}

describe("update phase predicates", () => {
  it("starts idle and enabled-aware", () => {
    expect(initialStatus("0.1.0+1", false)).toEqual({
      phase: "idle",
      currentVersion: "0.1.0+1",
      enabled: false,
    });
  });

  it("treats only network phases as busy", () => {
    expect(isBusy(status({ phase: "checking" }))).toBe(true);
    expect(isBusy(status({ phase: "downloading" }))).toBe(true);
    expect(isBusy(status({ phase: "applying" }))).toBe(true);
    for (const phase of ["idle", "current", "available", "ready", "failed", "manual"] as const) {
      expect(isBusy(status({ phase }))).toBe(false);
    }
  });
});

describe("install gating", () => {
  it("requires a downloaded build and an idle scheduler", () => {
    const ready = status({ phase: "ready", downloadedPath: "C:/tmp/app.zip" });
    expect(canInstallNow(ready, false)).toBe(true);
    expect(canInstallNow(ready, true)).toBe(false);
    expect(canInstallNow(status({ phase: "available" }), false)).toBe(false);
  });

  it("explains why installing is blocked", () => {
    expect(installBlockedReason(status({ phase: "available" }), false)).toBe(
      "还没有已下载完成的更新",
    );
    // 这条是本项目的核心约束：托盘常驻程序不能在任务跑一半时换掉自身目录。
    expect(installBlockedReason(status({ phase: "ready" }), true)).toBe(
      "有任务正在运行，等它结束后再安装",
    );
    expect(installBlockedReason(status({ phase: "ready" }), false)).toBeNull();
  });

  // 只发 --install 的版本会让 sidecar 以 LAYOUT_UNSUPPORTED 拒绝 apply，
  // 宿主必须自己先拦住，否则点「安装并重启」看起来毫无反应。
  it("refuses to apply a full-install-only build", () => {
    const ready = status({ phase: "ready", target: target({ requiresFullInstall: true }) });
    expect(installBlockedReason(ready, false)).toBe("这个版本只发了完整安装包，请下载后手动安装");
    expect(canInstallNow(ready, false)).toBe(false);
  });
});

describe("skip gating", () => {
  it("never allows skipping a mandatory update", () => {
    expect(canSkip(status({ phase: "available", target: target({ mandatory: true }) }))).toBe(false);
    expect(canSkip(status({ phase: "ready", target: target({ mandatory: true }) }))).toBe(false);
  });

  it("allows skipping an optional update once one exists", () => {
    expect(canSkip(status({ phase: "available", target: target() }))).toBe(true);
    expect(canSkip(status({ phase: "available" }))).toBe(false);
    expect(canSkip(status({ phase: "checking", target: target() }))).toBe(false);
  });
});

describe("progress formatting", () => {
  it("clamps the percentage and tolerates an unknown total", () => {
    expect(progressPercent(undefined)).toBe(0);
    expect(progressPercent({ receivedBytes: 5, totalBytes: 0, bytesPerSecond: 0 })).toBe(0);
    expect(progressPercent({ receivedBytes: 50, totalBytes: 200, bytesPerSecond: 0 })).toBe(25);
    expect(progressPercent({ receivedBytes: 900, totalBytes: 200, bytesPerSecond: 0 })).toBe(100);
  });

  it("scales byte counts", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(-1)).toBe("0 B");
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(20 * 1024)).toBe("20 KB");
    expect(formatBytes(96 * 1024 * 1024)).toBe("96 MB");
  });

  it("hides a zero speed instead of flashing 0 B/s", () => {
    expect(formatSpeed(0)).toBe("");
    expect(formatSpeed(Number.NaN)).toBe("");
    expect(formatSpeed(1024)).toBe("1.0 KB/s");
    expect(formatSpeed(12 * 1024 * 1024)).toBe("12 MB/s");
  });
});

describe("upgrade chain hint", () => {
  it("stays silent on the final hop", () => {
    expect(hopHint(undefined)).toBe("");
    expect(hopHint(target())).toBe("");
  });

  it("warns when the chain forces intermediate versions", () => {
    expect(hopHint(target({ remainingHops: 3, isFinalHop: false }))).toContain("还需要 2 次更新");
  });
});

describe("current code resolution", () => {
  it("uses the sentinel in development so a dev build never self-downgrades", () => {
    // SPEC §8.1：开发态报 0 会让开发构建乐于把自己替换成正式版。
    expect(DEV_CURRENT_CODE).toBe(2147483647);
    expect(resolveCurrentCode(false)).toBe(DEV_CURRENT_CODE);
    expect(resolveCurrentCode(true)).toBe(APP_VERSION_CODE);
  });
});

describe("versionedDir install root", () => {
  it("resolves both legacy and versioned installs to the stable root", () => {
    expect(resolveInstallDir("C:\\cronkit\\WorkspaceOrchestrator.exe")).toBe("C:\\cronkit");
    expect(
      resolveInstallDir("C:\\cronkit\\versions\\0.2.0+4\\WorkspaceOrchestrator.exe"),
    ).toBe("C:\\cronkit");
  });

  it("places the updater sidecar next to the stable launcher", () => {
    expect(updaterPath("C:\\cronkit")).toBe("C:\\cronkit\\relkit-updater.exe");
    expect(UPDATE_SIDECAR).toBe("relkit-updater.exe");
    expect(UPDATE_EXECUTABLE).toBe("WorkspaceOrchestrator.exe");
  });
});

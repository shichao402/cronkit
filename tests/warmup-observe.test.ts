import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { deadlineAtFromCron } from "../src/core/plan";
import { followUnityLog } from "../src/core/unity";

describe("deadlineAtFromCron", () => {
  it("returns undefined without deadline or bad format", () => {
    expect(deadlineAtFromCron(undefined, "Asia/Shanghai", new Date())).toBeUndefined();
    expect(deadlineAtFromCron("8:00", "Asia/Shanghai", new Date())).toBeUndefined();
  });

  it("keeps same-day deadline when trigger is before it", () => {
    // 2026-10-13 02:10 +08:00 = 2026-10-12 18:10 UTC
    const trigger = Date.UTC(2026, 9, 12, 18, 10);
    const deadline = deadlineAtFromCron("08:00", "Asia/Shanghai", trigger);
    // 同日 08:00 +08:00 = 2026-10-13 00:00 UTC
    expect(deadline).toBe(Date.UTC(2026, 9, 13, 0, 0));
  });

  it("rolls to next day when trigger passed the deadline (overnight window)", () => {
    // 2026-10-13 22:00 +08:00 = 2026-10-13 14:00 UTC，deadline 08:00 → 次日
    const trigger = Date.UTC(2026, 9, 13, 14, 0);
    const deadline = deadlineAtFromCron("08:00", "Asia/Shanghai", trigger);
    // 次日 08:00 +08:00 = 2026-10-14 00:00 UTC
    expect(deadline).toBe(Date.UTC(2026, 9, 14, 0, 0));
  });

  it("handles non-hour-offset timezone", () => {
    // 2026-10-13 09:30 IST(+05:30) = 04:00 UTC；deadline 18:00 当天 → 12:30 UTC
    const trigger = Date.UTC(2026, 9, 13, 4, 0);
    const deadline = deadlineAtFromCron("18:00", "Asia/Kolkata", trigger);
    expect(deadline).toBe(Date.UTC(2026, 9, 13, 12, 30));
  });
});

describe("followUnityLog", () => {
  it("streams new lines as heartbeat and collects warning lines", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "cronkit-unitylog-"));
    try {
      const logFile = path.join(dir, "unity.log");
      const beats: string[] = [];
      const tailer = followUnityLog(logFile, (line) => beats.push(line));

      // 首次采样：文件不存在属正常，不应心跳
      expect(beats).toEqual([]);

      writeFileSync(logFile, "\uFEFFDisplayProgressbar: something (10%)\n", "utf8");
      tailer.tickForTest();

      writeFileSync(logFile, "Refreshing native plugins\n", { flag: "a" });
      tailer.tickForTest();
      // 两个采样周期后：心跳推进到最新一行
      expect(beats[beats.length - 1]).toBe("Refreshing native plugins");

      writeFileSync(
        logFile,
        "Shader error: 'Foo' had invalid preprocessor\nException: something broke\nall good\n",
        { flag: "a" },
      );
      tailer.tickForTest();
      expect(beats[beats.length - 1]).toBe("all good");
      expect(tailer.warnings()).toEqual([
        "Shader error: 'Foo' had invalid preprocessor",
        "Exception: something broke",
      ]);

      tailer.stop();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("ignores duplicate warning lines and keeps last line only per sample", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "cronkit-unitylog-"));
    try {
      const logFile = path.join(dir, "unity.log");
      const beats: string[] = [];
      const tailer = followUnityLog(logFile, (line) => beats.push(line));

      writeFileSync(
        logFile,
        "error: same message\nerror: same message\nerror: same message\nfinal line\n",
        "utf8",
      );
      tailer.tickForTest();
      expect(beats).toEqual(["final line"]);
      expect(tailer.warnings()).toEqual(["error: same message"]);

      tailer.stop();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { isUnityLockHeld, parseTasklistCsv } from "../src/core/occupants";

describe("parseTasklistCsv", () => {
  it("picks Unity editor family and ignores unrelated processes", () => {
    const csv = [
      '"Unity.exe","41200","Console","1","1,024 K"',
      '"UnityCrashHandler64.exe","41201","Console","1","12 K"',
      '"rider64.exe","88856","Console","1","2,048 K"',
      '"explorer.exe","1234","Console","1","80 K"',
    ].join("\n");
    const found = parseTasklistCsv(csv);
    expect(found.map((item) => `${item.name}:${item.pid}`).sort()).toEqual([
      "Unity.exe:41200",
      "UnityCrashHandler64.exe:41201",
    ]);
    expect(found.every((item) => item.source === "process-name")).toBe(true);
  });

  it("skips malformed rows", () => {
    expect(parseTasklistCsv("INFO: No tasks are running which match the specified criteria.")).toEqual([]);
  });
});

describe("isUnityLockHeld", () => {
  it("treats missing lock as not held", () => {
    expect(isUnityLockHeld(path.join(os.tmpdir(), "cronkit-no-such-lock", "UnityLockfile"))).toBe(false);
  });

  it("treats openable leftover lock as stale, not held (win32)", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "cronkit-lock-"));
    try {
      const lockFile = path.join(dir, "UnityLockfile");
      writeFileSync(lockFile, "", "utf8");
      const expected = process.platform === "win32" ? false : true;
      expect(isUnityLockHeld(lockFile)).toBe(expected);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

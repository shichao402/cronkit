import { describe, expect, it } from "vitest";
import { spawnCaptured } from "../src/core/exec";

describe("spawnCaptured", () => {
  it("captures stdout without blocking the event loop", async () => {
    let ticks = 0;
    const timer = setInterval(() => {
      ticks += 1;
    }, 20);
    const result = await spawnCaptured({
      command: process.execPath,
      args: ["-e", "setTimeout(() => process.stdout.write('hello'), 80)"],
      timeoutMs: 10_000,
    });
    clearInterval(timer);
    expect(result.stdout).toContain("hello");
    expect(result.timedOut).toBe(false);
    expect(ticks).toBeGreaterThan(0);
  });

  it("rejects when aborted", async () => {
    const abort = new AbortController();
    const pending = spawnCaptured({
      command: process.execPath,
      args: ["-e", "setTimeout(() => {}, 10_000)"],
      timeoutMs: 10_000,
      abortSignal: abort.signal,
    });
    abort.abort();
    await expect(pending).rejects.toThrow("已取消");
  });
});

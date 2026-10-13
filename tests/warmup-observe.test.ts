import { describe, expect, it } from "vitest";
import { deadlineAtFromCron } from "../src/core/plan";

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

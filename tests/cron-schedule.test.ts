import { describe, expect, it } from "vitest";
import {
  buildCron,
  describeCron,
  parseSchedule,
  scheduleForKind,
  scheduleOutlook,
} from "../src/renderer/config-editor/cron";

describe("parseSchedule", () => {
  it("recognizes the four form-representable shapes", () => {
    expect(parseSchedule("10 2 * * *")).toEqual({ kind: "daily", hour: 2, minute: 10 });
    expect(parseSchedule("0 9 * * 1,3")).toEqual({
      kind: "weekly",
      weekdays: [1, 3],
      hour: 9,
      minute: 0,
    });
    expect(parseSchedule("15 * * * *")).toEqual({ kind: "hourly", minute: 15 });
    expect(parseSchedule("*/15 0-7 * * *")).toEqual({
      kind: "minutes",
      every: 15,
      fromHour: 0,
      toHour: 7,
    });
    expect(parseSchedule("*/30 * * * *")).toEqual({
      kind: "minutes",
      every: 30,
      fromHour: 0,
      toHour: 23,
    });
  });

  it("falls back to custom for shapes the form cannot express", () => {
    expect(parseSchedule("0 0 1 * *")).toBeNull();
    expect(parseSchedule("0 2 * * 1-5")).toBeNull();
    expect(parseSchedule("10 2 * *")).toBeNull();
    expect(parseSchedule("99 2 * * *")).toBeNull();
    expect(parseSchedule("*/15 8-2 * * *")).toBeNull();
  });

  it("round-trips through buildCron", () => {
    for (const cron of ["10 2 * * *", "0 9 * * 1,3", "15 * * * *", "*/15 0-7 * * *"]) {
      expect(buildCron(parseSchedule(cron)!)).toBe(cron);
    }
  });
});

describe("scheduleForKind", () => {
  it("keeps the existing time when switching daily to weekly", () => {
    const daily = parseSchedule("30 6 * * *")!;
    expect(scheduleForKind("weekly", daily)).toEqual({
      kind: "weekly",
      weekdays: [1],
      hour: 6,
      minute: 30,
    });
  });

  it("supplies defaults when the current expression is custom", () => {
    expect(scheduleForKind("daily", null)).toEqual({ kind: "daily", hour: 2, minute: 0 });
    expect(scheduleForKind("minutes", null)).toEqual({
      kind: "minutes",
      every: 15,
      fromHour: 0,
      toHour: 23,
    });
  });
});

describe("describeCron", () => {
  it("describes schedules in plain language", () => {
    expect(describeCron("10 2 * * *")).toBe("每天 02:10");
    expect(describeCron("0 9 * * 1,3")).toBe("每周一、三 09:00");
    expect(describeCron("15 * * * *")).toBe("每小时第 15 分");
    expect(describeCron("*/15 0-7 * * *")).toBe("0–7 点每 15 分钟");
    expect(describeCron("*/15 * * * *")).toBe("每 15 分钟");
  });

  it("flags empty and malformed expressions", () => {
    expect(describeCron("  ")).toBe("未设置时间");
    expect(describeCron("10 2 * *")).toContain("5 段");
    expect(describeCron("0 0 1 * *")).toBe("0 0 1 * *");
  });
});

describe("scheduleOutlook", () => {
  it("shortens same-day follow-up runs to time only", () => {
    const outlook = scheduleOutlook("*/30 * * * *", "Asia/Shanghai");
    expect(outlook).not.toBeNull();
    expect(outlook!.next).toMatch(/^\d{2}\/\d{2} \d{2}:\d{2}$/);
    expect(outlook!.later.every((item) => /^\d{2}:\d{2}$|^\d{2}\/\d{2} \d{2}:\d{2}$/.test(item))).toBe(
      true,
    );
  });

  it("returns null for an unparsable expression", () => {
    expect(scheduleOutlook("not a cron", "Asia/Shanghai")).toBeNull();
  });
});

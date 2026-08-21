import { CronExpressionParser } from "cron-parser";

export type Schedule =
  | { kind: "daily"; hour: number; minute: number }
  | { kind: "weekly"; weekdays: number[]; hour: number; minute: number }
  | { kind: "hourly"; minute: number }
  | { kind: "minutes"; every: number; fromHour: number; toHour: number };

export type ScheduleKind = Schedule["kind"] | "custom";

export const scheduleKindLabels: Record<ScheduleKind, string> = {
  daily: "每天",
  weekly: "每周",
  hourly: "每小时",
  minutes: "按分钟间隔",
  custom: "自定义 cron",
};

export const minuteIntervals = [5, 10, 15, 20, 30] as const;

const WEEKDAYS = ["日", "一", "二", "三", "四", "五", "六"];

export function weekdayLabel(day: number): string {
  return WEEKDAYS[day] ?? String(day);
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function fixed(field: string, max: number): number | null {
  if (!/^\d{1,2}$/.test(field)) {
    return null;
  }
  const value = Number(field);
  return value <= max ? value : null;
}

export function timeValue(hour: number, minute: number): string {
  return `${pad(hour)}:${pad(minute)}`;
}

export function parseTimeValue(value: string): { hour: number; minute: number } | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) {
    return null;
  }
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  return hour <= 23 && minute <= 59 ? { hour, minute } : null;
}

export function parseSchedule(cron: string): Schedule | null {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) {
    return null;
  }
  const [minField, hourField, dom, month, dow] = parts;
  if (dom !== "*" || month !== "*") {
    return null;
  }
  const minute = fixed(minField, 59);

  if (dow !== "*") {
    const hour = fixed(hourField, 23);
    if (minute == null || hour == null || !/^[0-6](,[0-6])*$/.test(dow)) {
      return null;
    }
    const weekdays = [...new Set(dow.split(",").map(Number))].sort((a, b) => a - b);
    return { kind: "weekly", weekdays, hour, minute };
  }

  if (minute != null) {
    if (hourField === "*") {
      return { kind: "hourly", minute };
    }
    const hour = fixed(hourField, 23);
    if (hour != null) {
      return { kind: "daily", hour, minute };
    }
    return null;
  }

  const step = /^\*\/(\d{1,2})$/.exec(minField);
  if (!step) {
    return null;
  }
  const every = Number(step[1]);
  if (every < 1 || every > 59) {
    return null;
  }
  if (hourField === "*") {
    return { kind: "minutes", every, fromHour: 0, toHour: 23 };
  }
  const range = /^(\d{1,2})-(\d{1,2})$/.exec(hourField);
  if (range) {
    const fromHour = Number(range[1]);
    const toHour = Number(range[2]);
    if (fromHour <= toHour && toHour <= 23) {
      return { kind: "minutes", every, fromHour, toHour };
    }
  }
  return null;
}

export function buildCron(schedule: Schedule): string {
  switch (schedule.kind) {
    case "daily":
      return `${schedule.minute} ${schedule.hour} * * *`;
    case "weekly": {
      const days = schedule.weekdays.length
        ? [...schedule.weekdays].sort((a, b) => a - b).join(",")
        : "*";
      return `${schedule.minute} ${schedule.hour} * * ${days}`;
    }
    case "hourly":
      return `${schedule.minute} * * * *`;
    case "minutes": {
      const allDay = schedule.fromHour === 0 && schedule.toHour === 23;
      const hours = allDay ? "*" : `${schedule.fromHour}-${schedule.toHour}`;
      return `*/${schedule.every} ${hours} * * *`;
    }
  }
}

/** 切换重复方式时尽量沿用当前时间，避免用户重新填一遍。 */
export function scheduleForKind(kind: Schedule["kind"], base: Schedule | null): Schedule {
  const hour = base?.kind === "daily" || base?.kind === "weekly" ? base.hour : 2;
  const minute = base && base.kind !== "minutes" ? base.minute : 0;
  switch (kind) {
    case "daily":
      return { kind: "daily", hour, minute };
    case "weekly":
      return {
        kind: "weekly",
        weekdays: base?.kind === "weekly" ? base.weekdays : [1],
        hour,
        minute,
      };
    case "hourly":
      return { kind: "hourly", minute };
    case "minutes":
      return {
        kind: "minutes",
        every: base?.kind === "minutes" ? base.every : 15,
        fromHour: base?.kind === "minutes" ? base.fromHour : 0,
        toHour: base?.kind === "minutes" ? base.toHour : 23,
      };
  }
}

export function withTime(schedule: Schedule, hour: number, minute: number): Schedule {
  switch (schedule.kind) {
    case "daily":
      return { kind: "daily", hour, minute };
    case "weekly":
      return { ...schedule, hour, minute };
    default:
      return schedule;
  }
}

export function describeSchedule(schedule: Schedule): string {
  switch (schedule.kind) {
    case "daily":
      return `每天 ${pad(schedule.hour)}:${pad(schedule.minute)}`;
    case "weekly": {
      const days = schedule.weekdays.map(weekdayLabel).join("、");
      return `每周${days || "—"} ${pad(schedule.hour)}:${pad(schedule.minute)}`;
    }
    case "hourly":
      return `每小时第 ${schedule.minute} 分`;
    case "minutes": {
      const allDay = schedule.fromHour === 0 && schedule.toHour === 23;
      return allDay
        ? `每 ${schedule.every} 分钟`
        : `${schedule.fromHour}–${schedule.toHour} 点每 ${schedule.every} 分钟`;
    }
  }
}

export function describeCron(cron: string): string {
  const trimmed = cron.trim();
  if (!trimmed) {
    return "未设置时间";
  }
  const schedule = parseSchedule(trimmed);
  if (schedule) {
    return describeSchedule(schedule);
  }
  if (trimmed.split(/\s+/).length !== 5) {
    return "cron 需要 5 段（分 时 日 月 周）";
  }
  return trimmed;
}

export function nextRuns(cron: string, timezone: string, count = 3): string[] {
  try {
    const expr = CronExpressionParser.parse(cron, { tz: timezone });
    const out: string[] = [];
    for (let i = 0; i < count; i += 1) {
      const iso = expr.next().toISOString();
      if (iso) {
        out.push(iso);
      }
    }
    return out;
  } catch {
    return [];
  }
}

function splitLocal(iso: string, timezone: string): { date: string; time: string } | null {
  try {
    const parts = new Intl.DateTimeFormat("zh-CN", {
      timeZone: timezone,
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(new Date(iso));
    const pick = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
    const [month, day, hour, minute] = [pick("month"), pick("day"), pick("hour"), pick("minute")];
    if (!month || !day || !hour || !minute) {
      return null;
    }
    return { date: `${month}/${day}`, time: `${hour === "24" ? "00" : hour}:${minute}` };
  } catch {
    return null;
  }
}

/** 紧凑展示接下来的几次触发：首次给完整日期，后续同日只给时间。 */
export function scheduleOutlook(
  cron: string,
  timezone: string,
  count = 3,
): { next: string; later: string[] } | null {
  const runs = nextRuns(cron, timezone, count)
    .map((iso) => splitLocal(iso, timezone))
    .filter((item): item is { date: string; time: string } => item !== null);
  const [first, ...rest] = runs;
  if (!first) {
    return null;
  }
  return {
    next: `${first.date} ${first.time}`,
    later: rest.map((item) => (item.date === first.date ? item.time : `${item.date} ${item.time}`)),
  };
}

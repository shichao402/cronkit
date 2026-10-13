import { CronExpressionParser } from "cron-parser";
import type { AppConfig, Target, Task } from "./config";
import { toInvocation } from "./config";
import { summarizeInvocation } from "./toolset";

export type PlannedItem = {
  scheduleId: string;
  taskId: string;
  taskName: string;
  scheduleDescription?: string;
  cron: string;
  nextRun: string | null;
  workspaceId: string;
  workspaceName: string;
  path: string;
  autoScheduled: boolean;
  steps: string[];
};

export function nextRunIso(cron: string, timezone: string): string | null {
  try {
    const expr = CronExpressionParser.parse(cron, { tz: timezone });
    return expr.next().toISOString();
  } catch {
    return null;
  }
}

export function previousFire(cron: string, timezone: string, at = new Date()): Date | null {
  try {
    const expr = CronExpressionParser.parse(cron, { tz: timezone, currentDate: at });
    return expr.prev().toDate();
  } catch {
    return null;
  }
}

/**
 * cron 触发器的 deadline（HH:mm，配置时区）映射为具体时刻：
 * 触发时刻的 wall-clock 早于 deadline → 当天截止；否则视为跨午夜窗口 → 次日截止。
 * wall-clock → epoch 用两次偏移迭代，兼容 DST 切换。
 */
export function deadlineAtFromCron(
  deadline: string | undefined,
  timezone: string,
  triggerTime: Date | number,
): number | undefined {
  if (!deadline) {
    return undefined;
  }
  const match = /^(\d{2}):(\d{2})$/.exec(deadline);
  if (!match) {
    return undefined;
  }
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  const at = triggerTime instanceof Date ? triggerTime.getTime() : new Date(triggerTime).getTime();

  const triggerWall = wallClockIn(timezone, at);
  const deadlineMinutes = hour * 60 + minute;
  const triggerMinutes = triggerWall.hour * 60 + triggerWall.minute;
  const nextDay = triggerMinutes >= deadlineMinutes;
  const deadlineWall = Date.UTC(
    triggerWall.year,
    triggerWall.month - 1,
    triggerWall.day + (nextDay ? 1 : 0),
    hour,
    minute,
  );
  // wall = epoch + offset ⇒ epoch = wall - offset；offset 随 epoch 变化，迭代两次收敛。
  const firstGuess = deadlineWall - zoneOffsetMs(timezone, deadlineWall);
  return deadlineWall - zoneOffsetMs(timezone, firstGuess);
}

type WallClock = { year: number; month: number; day: number; hour: number; minute: number };

function wallClockIn(timezone: string, epoch: number): WallClock {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date(epoch));
  const get = (type: string): number => Number(parts.find((p) => p.type === type)?.value ?? "0");
  return { year: get("year"), month: get("month"), day: get("day"), hour: get("hour"), minute: get("minute") };
}

/** 求某时刻在配置时区的偏移（wall - epoch）。 */
function zoneOffsetMs(timezone: string, epoch: number): number {
  const wall = wallClockIn(timezone, epoch);
  return Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute) - epoch;
}

export function describeSteps(target: Target): string[] {
  return target.steps.map((step) => {
    const inv = toInvocation(step);
    return `${summarizeInvocation(inv)} (timeout ${inv.timeout})`;
  });
}

export function buildPlan(config: AppConfig): PlannedItem[] {
  const scheduled = new Set<string>();
  const items: PlannedItem[] = [];

  for (const task of config.tasks) {
    if (!task.enabled) {
      continue;
    }
    if (task.trigger.type !== "cron") {
      continue;
    }
    const nextRun = nextRunIso(task.trigger.cron, config.timezone);
    for (const target of task.targets) {
      scheduled.add(target.id);
      items.push({
        scheduleId: task.id,
        taskId: task.id,
        taskName: task.name,
        scheduleDescription: task.name,
        cron: task.trigger.cron,
        nextRun,
        workspaceId: target.id,
        workspaceName: target.name,
        path: target.path,
        autoScheduled: true,
        steps: describeSteps(target),
      });
    }
  }

  for (const task of config.tasks) {
    for (const target of task.targets) {
      if (scheduled.has(target.id)) {
        continue;
      }
      items.push({
        scheduleId: "manual",
        taskId: task.id,
        taskName: task.name,
        cron: "-",
        nextRun: null,
        workspaceId: target.id,
        workspaceName: target.name,
        path: target.path,
        autoScheduled: false,
        steps: describeSteps(target),
      });
    }
  }

  return items;
}

export function previewCron(cron: string, timezone: string, count = 3): string[] {
  try {
    const expr = CronExpressionParser.parse(cron, { tz: timezone });
    const out: string[] = [];
    for (let i = 0; i < count; i += 1) {
      // cron-parser 对无法表示的时间点返回 null，此时后面的也没意义了。
      const iso = expr.next().toISOString();
      if (iso === null) {
        break;
      }
      out.push(iso);
    }
    return out;
  } catch {
    return [];
  }
}

export type { Task, Target };

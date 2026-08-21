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
      out.push(expr.next().toISOString());
    }
    return out;
  } catch {
    return [];
  }
}

export type { Task, Target };

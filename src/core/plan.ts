import { CronExpressionParser } from "cron-parser";
import type { AppConfig } from "./config";

export type PlannedItem = {
  scheduleId: string;
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

export function describeSteps(config: AppConfig, workspaceId: string): string[] {
  const workspace = config.workspaces.find((item) => item.id === workspaceId);
  if (!workspace) {
    return [];
  }
  return workspace.steps.map((step) => {
    if (step.type === "svn-update") {
      return `svn-update (${step.strategy}, timeout ${step.timeout})`;
    }
    if (step.type === "unity-warmup") {
      const extra = step.nographics ? ", nographics" : "";
      const sub = step.path ? `, ${step.path}` : "";
      return `unity-warmup (timeout ${step.timeout}${sub}${extra})`;
    }
    const args = step.args.length > 0 ? ` ${step.args.join(" ")}` : "";
    return `script (${step.command}${args}, timeout ${step.timeout})`;
  });
}

export function buildPlan(config: AppConfig): PlannedItem[] {
  const scheduled = new Set<string>();
  const items: PlannedItem[] = [];

  for (const schedule of config.schedules) {
    const nextRun = nextRunIso(schedule.cron, config.timezone);
    for (const workspaceId of schedule.workspaceIds) {
      const workspace = config.workspaces.find((item) => item.id === workspaceId);
      if (!workspace) {
        continue;
      }
      scheduled.add(workspace.id);
      items.push({
        scheduleId: schedule.id,
        scheduleDescription: schedule.description,
        cron: schedule.cron,
        nextRun,
        workspaceId: workspace.id,
        workspaceName: workspace.name,
        path: workspace.path,
        autoScheduled: true,
        steps: describeSteps(config, workspace.id),
      });
    }
  }

  for (const workspace of config.workspaces) {
    if (scheduled.has(workspace.id)) {
      continue;
    }
    items.push({
      scheduleId: "manual",
      cron: "-",
      nextRun: null,
      workspaceId: workspace.id,
      workspaceName: workspace.name,
      path: workspace.path,
      autoScheduled: false,
      steps: describeSteps(config, workspace.id),
    });
  }

  return items;
}

import type { AppConfig, AppConfigV1, Step, Target, Task } from "./config";
import { canonicalizeStep } from "../shared/canonicalize-step";

export type MigrationResult = {
  config: AppConfig;
  warnings: string[];
};

export { canonicalizeStep };

function cloneTargetFromWorkspace(
  workspace: AppConfigV1["workspaces"][number],
  id: string,
): Target {
  return {
    id,
    name: workspace.name,
    path: workspace.path,
    oncePerDay: workspace.oncePerDay,
    steps: workspace.steps.map((step) => canonicalizeStep(step as Record<string, unknown>) as Step),
  };
}

/**
 * Convert a v1 schedule/workspace config into task-first v2.
 * When the same workspace appears in multiple schedules, later copies get
 * `{ws.id}@{task.id}` so target ids stay globally unique (keyed history may diverge).
 */
export function migrateV1toV2(v1: AppConfigV1): MigrationResult {
  const warnings: string[] = [];
  const usedTargetIds = new Set<string>();
  const scheduledWorkspaceIds = new Set<string>();
  const tasks: Task[] = [];

  for (const schedule of v1.schedules) {
    const targets: Target[] = [];
    for (const workspaceId of schedule.workspaceIds) {
      const workspace = v1.workspaces.find((item) => item.id === workspaceId);
      if (!workspace) {
        warnings.push(`schedule ${schedule.id} 引用了不存在的 workspace: ${workspaceId}`);
        continue;
      }
      scheduledWorkspaceIds.add(workspace.id);
      let targetId = workspace.id;
      if (usedTargetIds.has(targetId)) {
        targetId = `${workspace.id}@${schedule.id}`;
        warnings.push(
          `workspace ${workspace.id} 被多个 schedule 引用，迁移后副本 id 为 ${targetId}`,
        );
      }
      usedTargetIds.add(targetId);
      targets.push(cloneTargetFromWorkspace(workspace, targetId));
    }
    if (targets.length === 0) {
      warnings.push(`schedule ${schedule.id} 没有有效 workspace，已跳过`);
      continue;
    }
    tasks.push({
      id: schedule.id,
      name: schedule.description?.trim() || schedule.id,
      enabled: true,
      trigger: { type: "cron", cron: schedule.cron },
      targets,
    });
  }

  for (const workspace of v1.workspaces) {
    if (scheduledWorkspaceIds.has(workspace.id)) {
      continue;
    }
    let targetId = workspace.id;
    if (usedTargetIds.has(targetId)) {
      targetId = `${workspace.id}@manual`;
      warnings.push(`手动 workspace ${workspace.id} id 冲突，迁移为 ${targetId}`);
    }
    usedTargetIds.add(targetId);
    tasks.push({
      id: `manual-${workspace.id}`,
      name: workspace.name,
      enabled: true,
      trigger: { type: "manual" },
      targets: [cloneTargetFromWorkspace(workspace, targetId)],
    });
  }

  if (tasks.length === 0) {
    throw new Error("v1 迁移失败：没有可生成的 task");
  }

  return {
    config: {
      version: 2,
      timezone: v1.timezone,
      runtime: { ...v1.runtime },
      stepTemplates: [],
      tasks,
      reporting: { ...v1.reporting },
      brain: { ...v1.brain },
    },
    warnings,
  };

}

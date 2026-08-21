import { toInvocation, type AppConfig, type Step } from "./config";
import { draftToYaml } from "../shared/draft-yaml";
import type { EditorDraft, EditorStep, EditorTarget, EditorTask } from "../shared/types";

export { draftToYaml };

export function configToDraft(config: AppConfig): EditorDraft {
  return {
    version: 2,
    timezone: config.timezone,
    runtime: {
      maxConcurrentRuns: config.runtime.maxConcurrentRuns,
      catchUpPreviousDays: config.runtime.catchUpPreviousDays,
      retryFailedOnCatchUp: config.runtime.retryFailedOnCatchUp,
      releaseOccupants: config.runtime.releaseOccupants,
      releaseGraceMs: config.runtime.releaseGraceMs,
    },
    tasks: config.tasks.map(taskToEditor),
    reporting: config.reporting as Record<string, unknown>,
    brain: config.brain as Record<string, unknown>,
  };
}

function taskToEditor(task: AppConfig["tasks"][number]): EditorTask {
  return {
    id: task.id,
    name: task.name,
    enabled: task.enabled,
    trigger:
      task.trigger.type === "cron"
        ? { type: "cron", cron: task.trigger.cron }
        : { type: "manual" },
    targets: task.targets.map(targetToEditor),
  };
}

function targetToEditor(target: AppConfig["tasks"][number]["targets"][number]): EditorTarget {
  return {
    id: target.id,
    name: target.name,
    path: target.path.replace(/\\/g, "/"),
    oncePerDay: target.oncePerDay,
    steps: target.steps.map(stepToEditor),
  };
}

function stepToEditor(step: Step): EditorStep {
  const inv = toInvocation(step);
  return {
    toolsetId: inv.toolsetId,
    tool: inv.tool,
    timeout: inv.timeout,
    retry: inv.retry,
    continueOnError: inv.continueOnError,
    path: inv.path,
    args: inv.rawArgs,
    params: { ...inv.params },
  };
}

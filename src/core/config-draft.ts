import { toInvocation, type AppConfig, type Step } from "./config";
import { draftToYaml } from "../shared/draft-yaml";
import type { EditorDraft, EditorStep } from "../shared/types";

export { draftToYaml };

export function configToDraft(config: AppConfig): EditorDraft {
  return {
    version: 1,
    timezone: config.timezone,
    runtime: {
      maxConcurrentRuns: config.runtime.maxConcurrentRuns,
      catchUpPreviousDays: config.runtime.catchUpPreviousDays,
      retryFailedOnCatchUp: config.runtime.retryFailedOnCatchUp,
      releaseOccupants: config.runtime.releaseOccupants,
      releaseGraceMs: config.runtime.releaseGraceMs,
    },
    schedules: config.schedules.map((item) => ({
      id: item.id,
      description: item.description ?? "",
      cron: item.cron,
      workspaceIds: [...item.workspaceIds],
    })),
    workspaces: config.workspaces.map((workspace) => ({
      id: workspace.id,
      name: workspace.name,
      path: workspace.path.replace(/\\/g, "/"),
      oncePerDay: workspace.oncePerDay,
      steps: workspace.steps.map(stepToEditor),
    })),
    reporting: config.reporting as Record<string, unknown>,
    brain: config.brain as Record<string, unknown>,
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
    params: { ...inv.params },
  };
}

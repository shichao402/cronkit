import { toInvocation, type AppConfig, type Step } from "./config";
import { draftToYaml } from "../shared/draft-yaml";
import type {
  EditorDraft,
  EditorStep,
  EditorTarget,
  EditorTask,
  StepTemplate,
} from "../shared/types";

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
    stepTemplates: (config.stepTemplates ?? []).map(templateToEditor),
    tasks: config.tasks.map(taskToEditor),
    reporting: config.reporting as Record<string, unknown>,
    brain: config.brain as Record<string, unknown>,
  };
}

function templateToEditor(template: AppConfig["stepTemplates"][number]): StepTemplate {
  return {
    id: template.id,
    name: template.name,
    vars: template.vars.map((item) => ({
      name: item.name,
      default: item.default,
      description: item.description,
    })),
    steps: template.steps.map(stepToEditor),
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

/**
 * 注意：config 在解析阶段已把模板展开进 target.steps。
 * 这里保留 usesTemplate/vars，让编辑器继续按「引用」呈现并原样存回，
 * 否则一次保存就会把模板摊平成各目标的独立步骤。
 */
function targetToEditor(target: AppConfig["tasks"][number]["targets"][number]): EditorTarget {
  const base = {
    id: target.id,
    name: target.name,
    path: target.path.replace(/\\/g, "/"),
    oncePerDay: target.oncePerDay,
  };
  if (target.usesTemplate) {
    return {
      ...base,
      usesTemplate: target.usesTemplate,
      vars: target.vars ? { ...target.vars } : {},
      steps: [],
    };
  }
  return { ...base, steps: target.steps.map(stepToEditor) };
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

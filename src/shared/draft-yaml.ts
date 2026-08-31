import { stringify } from "yaml";
import type { EditorDraft, EditorStep, EditorTarget, EditorTask, StepTemplate } from "./types";
import { canonicalizeStep } from "./canonicalize-step";

export function draftToYaml(draft: EditorDraft): string {
  const templates = draft.stepTemplates ?? [];
  const doc = {
    version: 2 as const,
    timezone: draft.timezone,
    runtime: {
      maxConcurrentRuns: draft.runtime.maxConcurrentRuns,
      catchUpPreviousDays: draft.runtime.catchUpPreviousDays,
      retryFailedOnCatchUp: draft.runtime.retryFailedOnCatchUp,
      ...(draft.runtime.releaseOccupants === false ? { releaseOccupants: false } : {}),
      ...(draft.runtime.releaseGraceMs !== undefined && draft.runtime.releaseGraceMs !== 20_000
        ? { releaseGraceMs: draft.runtime.releaseGraceMs }
        : {}),
    },
    ...(templates.length > 0
      ? { stepTemplates: templates.map((item) => templateToYaml(item)) }
      : {}),
    tasks: draft.tasks.map((task) => taskToYaml(task)),
    reporting: draft.reporting,
    brain: draft.brain,
  };

  return `# 工作目录编排器
# 由应用内配置页保存。密钥不要写入本文件。

${stringify(doc, { indent: 2, lineWidth: 0, aliasDuplicateObjects: false })}`;
}

function templateToYaml(template: StepTemplate): Record<string, unknown> {
  return {
    id: template.id.trim(),
    name: template.name.trim(),
    ...(template.vars.length > 0
      ? {
          vars: template.vars.map((item) => ({
            name: item.name.trim(),
            ...(item.default !== undefined && item.default !== ""
              ? { default: item.default }
              : {}),
            ...(item.description ? { description: item.description } : {}),
          })),
        }
      : {}),
    steps: template.steps.map((step) => stepToYaml(step)),
  };
}

function taskToYaml(task: EditorTask): Record<string, unknown> {
  const trigger =
    task.trigger.type === "cron"
      ? { type: "cron", cron: task.trigger.cron.trim() }
      : { type: "manual" };
  return {
    id: task.id.trim(),
    name: task.name.trim(),
    ...(task.enabled === false ? { enabled: false } : {}),
    trigger,
    targets: task.targets.map((target) => targetToYaml(target)),
  };
}

function targetToYaml(target: EditorTarget): Record<string, unknown> {
  const vars = Object.fromEntries(
    Object.entries(target.vars ?? {}).filter(([, value]) => value !== undefined && value !== ""),
  );
  if (target.usesTemplate) {
    return {
      id: target.id.trim(),
      name: target.name.trim(),
      path: target.path.replace(/\\/g, "/"),
      ...(target.oncePerDay === false ? { oncePerDay: false } : {}),
      usesTemplate: target.usesTemplate,
      ...(Object.keys(vars).length > 0 ? { vars } : {}),
    };
  }
  return {
    id: target.id.trim(),
    name: target.name.trim(),
    path: target.path.replace(/\\/g, "/"),
    ...(target.oncePerDay === false ? { oncePerDay: false } : {}),
    steps: target.steps.map((step) => stepToYaml(step)),
  };
}

function stepToYaml(step: EditorStep): Record<string, unknown> {
  return canonicalizeStep({
    type: "toolset",
    toolsetId: step.toolsetId,
    tool: step.tool,
    with: step.params,
    timeout: step.timeout.trim() || "30m",
    retry: step.retry,
    continueOnError: step.continueOnError,
    ...(step.path ? { path: step.path } : {}),
    ...(step.args && step.args.length > 0 ? { args: step.args } : {}),
  });
}

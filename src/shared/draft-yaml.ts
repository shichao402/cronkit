import { stringify } from "yaml";
import type { EditorDraft, EditorWorkspace } from "./types";

export function draftToYaml(draft: EditorDraft): string {
  const doc = {
    version: 1 as const,
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
    schedules: draft.schedules.map((item) => ({
      id: item.id.trim(),
      ...(item.description?.trim() ? { description: item.description.trim() } : {}),
      cron: item.cron.trim(),
      workspaceIds: item.workspaceIds,
    })),
    workspaces: draft.workspaces.map((workspace) => workspaceToYaml(workspace)),
    reporting: draft.reporting,
    brain: draft.brain,
  };

  return `# 工作目录编排器
# 由应用内配置页保存。密钥不要写入本文件。

${stringify(doc, { indent: 2, lineWidth: 0, aliasDuplicateObjects: false })}`;
}

function workspaceToYaml(workspace: EditorWorkspace): Record<string, unknown> {
  return {
    id: workspace.id.trim(),
    name: workspace.name.trim(),
    path: workspace.path.replace(/\\/g, "/"),
    ...(workspace.oncePerDay === false ? { oncePerDay: false } : {}),
    steps: workspace.steps.map((step) => {
      const withParams = compactParams(step.params);
      const node: Record<string, unknown> = {
        type: "toolset",
        toolsetId: step.toolsetId,
        tool: step.tool,
        timeout: step.timeout.trim() || "30m",
      };
      if (Object.keys(withParams).length > 0) {
        node.with = withParams;
      }
      if (typeof step.retry === "number" && step.retry > 0) {
        node.retry = step.retry;
      }
      if (step.continueOnError) {
        node.continueOnError = true;
      }
      return node;
    }),
  };
}

function compactParams(params: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(params ?? {})) {
    if (value === undefined || value === null || value === "") {
      continue;
    }
    if (Array.isArray(value) && value.length === 0) {
      continue;
    }
    out[key] = value;
  }
  return out;
}

import { describe, expect, it } from "vitest";
import { expandTemplate, collectVarNames } from "../src/shared/step-template";
import {
  applyTemplateToTarget,
  createTask,
  deleteTemplate,
  detachTemplateFromTarget,
  extractTemplateFromTarget,
  undeclaredVarNames,
  validateDraftLocally,
} from "../src/renderer/config-editor/state";
import type { EditorDraft, StepTemplate } from "../src/shared/types";

const template: StepTemplate = {
  id: "tpl-1",
  name: "OSG 夜间步骤",
  vars: [{ name: "branch", default: "trunk" }],
  steps: [
    { toolsetId: "osg", tool: "revert-generated", timeout: "5m", params: { deep: true } },
    {
      toolsetId: "builtin",
      tool: "svn-update",
      timeout: "2h",
      params: { strategy: "follow-latest", note: "${branch} @ ${target.name}" },
    },
  ],
};

function draftWith(templates: StepTemplate[]): EditorDraft {
  return {
    version: 2,
    timezone: "Asia/Shanghai",
    runtime: { maxConcurrentRuns: 1, catchUpPreviousDays: 0, retryFailedOnCatchUp: false },
    stepTemplates: templates,
    tasks: [createTask([])],
    reporting: {},
    brain: {},
  };
}

describe("expandTemplate", () => {
  it("substitutes declared vars, defaults and builtin target fields", () => {
    const { steps, issues } = expandTemplate(template, {
      id: "t1",
      name: "OSG 分支 1",
      path: "D:/workspace/OSG1",
    });
    expect(issues).toEqual([]);
    expect(steps[1].params.note).toBe("trunk @ OSG 分支 1");
  });

  it("lets the target override the template default", () => {
    const { steps } = expandTemplate(template, {
      id: "t1",
      name: "OSG 分支 2",
      path: "D:/workspace/OSG2",
      vars: { branch: "pub1" },
    });
    expect(steps[1].params.note).toBe("pub1 @ OSG 分支 2");
  });

  it("reports vars that have no value at all", () => {
    const bare: StepTemplate = {
      ...template,
      vars: [],
      steps: [
        { toolsetId: "builtin", tool: "script", timeout: "5m", params: { command: "${missing}" } },
      ],
    };
    const { issues } = expandTemplate(bare, { id: "t", name: "n", path: "p" });
    expect(issues.map((item) => item.name)).toEqual(["missing"]);
  });

  it("does not mutate the template itself", () => {
    expandTemplate(template, { id: "t", name: "n", path: "p", vars: { branch: "x" } });
    expect(template.steps[1].params.note).toBe("${branch} @ ${target.name}");
  });
});

describe("collectVarNames / undeclaredVarNames", () => {
  it("finds placeholders nested in params", () => {
    expect([...collectVarNames({ a: ["${x}"], b: { c: "${y}" } })].sort()).toEqual(["x", "y"]);
  });

  it("ignores builtin target.* when reporting undeclared vars", () => {
    expect(undeclaredVarNames(template)).toEqual([]);
  });

  it("flags vars used but not declared", () => {
    const t: StepTemplate = {
      ...template,
      vars: [],
      steps: [
        { toolsetId: "builtin", tool: "script", timeout: "5m", params: { command: "${branch}" } },
      ],
    };
    expect(undeclaredVarNames(t)).toEqual(["branch"]);
  });
});

describe("template binding on targets", () => {
  it("applying a template clears the target's own steps", () => {
    const draft = draftWith([template]);
    const taskId = draft.tasks[0].id;
    const targetId = draft.tasks[0].targets[0].id;
    const next = applyTemplateToTarget(draft, taskId, targetId, template.id);
    const target = next.tasks[0].targets[0];
    expect(target.usesTemplate).toBe(template.id);
    expect(target.steps).toEqual([]);
  });

  it("detaching expands the template into the target's own steps", () => {
    let draft = draftWith([template]);
    const taskId = draft.tasks[0].id;
    const targetId = draft.tasks[0].targets[0].id;
    draft = applyTemplateToTarget(draft, taskId, targetId, template.id);
    draft = detachTemplateFromTarget(draft, taskId, targetId);
    const target = draft.tasks[0].targets[0];
    expect(target.usesTemplate).toBeUndefined();
    expect(target.steps).toHaveLength(2);
    expect(target.steps[1].params.note).toContain("trunk");
  });

  it("deleting a template keeps referencing targets runnable", () => {
    let draft = draftWith([template]);
    const taskId = draft.tasks[0].id;
    const targetId = draft.tasks[0].targets[0].id;
    draft = applyTemplateToTarget(draft, taskId, targetId, template.id);
    draft = deleteTemplate(draft, template.id);
    expect(draft.stepTemplates).toEqual([]);
    const target = draft.tasks[0].targets[0];
    expect(target.usesTemplate).toBeUndefined();
    expect(target.steps).toHaveLength(2);
  });

  it("extracting a template replaces the literal target path with a placeholder", () => {
    let draft = draftWith([]);
    const taskId = draft.tasks[0].id;
    const targetId = draft.tasks[0].targets[0].id;
    draft = {
      ...draft,
      tasks: draft.tasks.map((task) => ({
        ...task,
        targets: task.targets.map((target) => ({
          ...target,
          path: "D:/workspace/OSG1",
          steps: [
            {
              toolsetId: "builtin",
              tool: "script",
              timeout: "5m",
              params: { command: "D:/workspace/OSG1/build.bat" },
            },
          ],
        })),
      })),
    };
    const result = extractTemplateFromTarget(draft, taskId, targetId, "通用步骤");
    expect(result).toBeDefined();
    const created = result!.draft.stepTemplates[0];
    expect(created.name).toBe("通用步骤");
    expect(created.steps[0].params.command).toBe("${target.path}/build.bat");
    expect(result!.draft.tasks[0].targets[0].usesTemplate).toBe(created.id);
  });
});

describe("validateDraftLocally with templates", () => {
  it("accepts a target that only references a template", () => {
    let draft = draftWith([template]);
    const taskId = draft.tasks[0].id;
    const targetId = draft.tasks[0].targets[0].id;
    draft = applyTemplateToTarget(draft, taskId, targetId, template.id);
    draft = {
      ...draft,
      tasks: draft.tasks.map((task) => ({
        ...task,
        targets: task.targets.map((target) => ({ ...target, path: "D:/workspace/OSG1" })),
      })),
    };
    expect(validateDraftLocally(draft)).toEqual([]);
  });

  it("rejects a reference to a template that does not exist", () => {
    let draft = draftWith([]);
    const taskId = draft.tasks[0].id;
    const targetId = draft.tasks[0].targets[0].id;
    draft = applyTemplateToTarget(draft, taskId, targetId, "tpl-missing");
    draft = {
      ...draft,
      tasks: draft.tasks.map((task) => ({
        ...task,
        targets: task.targets.map((target) => ({ ...target, path: "D:/workspace/OSG1" })),
      })),
    };
    const issues = validateDraftLocally(draft);
    expect(issues.some((item) => item.message.includes("tpl-missing"))).toBe(true);
  });

  it("rejects a required var left empty", () => {
    const required: StepTemplate = {
      ...template,
      vars: [{ name: "branch" }],
    };
    let draft = draftWith([required]);
    const taskId = draft.tasks[0].id;
    const targetId = draft.tasks[0].targets[0].id;
    draft = applyTemplateToTarget(draft, taskId, targetId, required.id);
    draft = {
      ...draft,
      tasks: draft.tasks.map((task) => ({
        ...task,
        targets: task.targets.map((target) => ({ ...target, path: "D:/workspace/OSG1" })),
      })),
    };
    const issues = validateDraftLocally(draft);
    expect(issues.some((item) => item.path.endsWith("vars.branch"))).toBe(true);
  });
});

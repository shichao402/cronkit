import { describe, expect, it } from "vitest";
import {
  createInitialState,
  createTask,
  duplicateTarget,
  editorReducer,
  validateDraftLocally,
  type EditorState,
} from "../src/renderer/config-editor/state";
import type { ConfigEditorPayload, EditorTarget } from "../src/shared/types";

function loaded(): EditorState {
  const payload: ConfigEditorPayload = {
    path: "x.yaml",
    text: "version: 2",
    revision: "r1",
    toolsets: [],
    draft: {
      version: 2,
      timezone: "Asia/Shanghai",
      runtime: {
        maxConcurrentRuns: 1,
        catchUpPreviousDays: 0,
        retryFailedOnCatchUp: false,
      },
      tasks: [createTask([])],
      reporting: {},
      brain: {},
    },
  };
  return editorReducer(createInitialState(), { type: "LOAD", payload });
}

describe("editor reducer", () => {
  it("loads draft and selects first task", () => {
    const state = loaded();
    expect(state.draft?.tasks).toHaveLength(1);
    expect(state.selection).toEqual({ kind: "task", taskId: state.draft!.tasks[0].id });
    expect(state.dirty).toBe(false);
  });

  it("supports undo after patch", () => {
    let state = loaded();
    const before = state.draft!;
    const next = {
      ...before,
      tasks: before.tasks.map((t) => ({ ...t, name: "改名" })),
    };
    state = editorReducer(state, { type: "PATCH_DRAFT", draft: next });
    expect(state.draft?.tasks[0].name).toBe("改名");
    expect(state.dirty).toBe(true);
    state = editorReducer(state, { type: "UNDO" });
    expect(state.draft?.tasks[0].name).toBe(before.tasks[0].name);
  });

  it("flags an unparsable cron expression locally", () => {
    const state = loaded();
    const draft = structuredClone(state.draft!);
    draft.tasks[0].trigger = { type: "cron", cron: "abc" };
    expect(validateDraftLocally(draft).some((i) => i.message.includes("cron"))).toBe(true);

    draft.tasks[0].trigger = { type: "cron", cron: "0 2 * * 1-5" };
    expect(validateDraftLocally(draft).some((i) => i.message.includes("cron"))).toBe(false);
  });

  it("flags empty path locally", () => {
    const state = loaded();
    const draft = structuredClone(state.draft!);
    draft.tasks[0].targets[0].path = "";
    const issues = validateDraftLocally(draft);
    expect(issues.some((i) => i.message.includes("路径"))).toBe(true);
  });
});

describe("duplicateTarget", () => {
  const source: EditorTarget = {
    id: "osg-core-only4",
    name: "OSGameCoreOnly4",
    path: "D:/workspace/OSGameCoreOnly4",
    oncePerDay: true,
    steps: [{ toolsetId: "osg", tool: "revert-generated", timeout: "5m", params: { deep: true } }],
  };

  it("bumps the trailing number of id, name and path", () => {
    const copy = duplicateTarget(source, new Set([source.id]), new Set([source.name]));
    expect(copy.id).toBe("osg-core-only5");
    expect(copy.name).toBe("OSGameCoreOnly5");
    expect(copy.path).toBe("D:/workspace/OSGameCoreOnly5");
  });

  it("keeps bumping past ids and names that are already used", () => {
    const copy = duplicateTarget(
      source,
      new Set([source.id, "osg-core-only5"]),
      new Set([source.name, "OSGameCoreOnly5"]),
    );
    expect(copy.id).toBe("osg-core-only6");
    expect(copy.name).toBe("OSGameCoreOnly6");
  });

  it("falls back to a suffix when there is no trailing number", () => {
    const plain: EditorTarget = { ...source, id: "trunk", name: "工作目录", path: "D:/trunk" };
    const copy = duplicateTarget(plain, new Set(["trunk"]), new Set(["工作目录"]));
    expect(copy.id).toBe("trunk-copy");
    expect(copy.name).toBe("工作目录 副本");
    expect(copy.path).toBe("D:/trunk");
  });

  it("deep-copies steps so edits do not leak back to the source", () => {
    const copy = duplicateTarget(source, new Set(), new Set());
    (copy.steps[0].params as { deep: boolean }).deep = false;
    expect(source.steps[0].params.deep).toBe(true);
  });
});

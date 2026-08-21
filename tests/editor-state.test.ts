import { describe, expect, it } from "vitest";
import {
  createInitialState,
  createTask,
  editorReducer,
  validateDraftLocally,
  type EditorState,
} from "../src/renderer/config-editor/state";
import type { ConfigEditorPayload } from "../src/shared/types";

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

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
      stepTemplates: [],
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

describe("配置左栏页签", () => {
  it("加载后默认停在任务配置页", () => {
    expect(loaded().railTab).toBe("tasks");
  });

  it("切到步骤模板页时，主面板一起带过去（没有模板则为空态）", () => {
    let state = loaded();
    state = editorReducer(state, { type: "SET_RAIL_TAB", tab: "templates" });
    expect(state.railTab).toBe("templates");
    // mock 草稿里没有模板，落到空态，而不是继续显示任务表单。
    expect(state.selection).toEqual({ kind: "none" });
  });

  it("切到步骤模板页时自动选中第一个模板", () => {
    const base = loaded();
    const draft = structuredClone(base.draft!);
    draft.stepTemplates = [{ id: "tpl-9", name: "共用步骤", vars: [], steps: [] }];
    let state = editorReducer(base, { type: "PATCH_DRAFT", draft });
    state = editorReducer(state, { type: "SET_RAIL_TAB", tab: "templates" });
    expect(state.selection).toEqual({ kind: "template", templateId: "tpl-9" });
  });

  it("切回任务页时自动选中第一个任务", () => {
    let state = editorReducer(loaded(), { type: "SET_RAIL_TAB", tab: "templates" });
    const taskId = state.draft!.tasks[0].id;
    state = editorReducer(state, { type: "SET_RAIL_TAB", tab: "tasks" });
    expect(state.selection).toEqual({ kind: "task", taskId });
  });

  it("点当前已选中的页签不改动选中项", () => {
    const state = loaded();
    const next = editorReducer(state, { type: "SET_RAIL_TAB", tab: "tasks" });
    expect(next.selection).toEqual(state.selection);
  });


  it("选中模板时自动切到模板页（抽成模板后直接可编辑）", () => {
    let state = loaded();
    expect(state.railTab).toBe("tasks");
    state = editorReducer(state, {
      type: "SELECT",
      selection: { kind: "template", templateId: "tpl-1" },
    });
    expect(state.railTab).toBe("templates");
  });

  it("选中任务/目标时自动切回任务页", () => {
    let state = editorReducer(loaded(), { type: "SET_RAIL_TAB", tab: "templates" });
    state = editorReducer(state, {
      type: "SELECT",
      selection: { kind: "target", taskId: "t1", targetId: "g1" },
    });
    expect(state.railTab).toBe("tasks");
  });

  it("选中运行时不改变当前页签", () => {
    let state = editorReducer(loaded(), { type: "SET_RAIL_TAB", tab: "templates" });
    state = editorReducer(state, { type: "SELECT", selection: { kind: "runtime" } });
    expect(state.railTab).toBe("templates");
  });

  it("删除模板后清空选中，但仍留在模板页", () => {
    let state = editorReducer(loaded(), {
      type: "SELECT",
      selection: { kind: "template", templateId: "tpl-1" },
    });
    state = editorReducer(state, { type: "SELECT", selection: { kind: "none" } });
    expect(state.railTab).toBe("templates");
    expect(state.selection).toEqual({ kind: "none" });
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

  it("bumps the trailing number of name and path, and auto-assigns a fresh id", () => {
    const copy = duplicateTarget(source, new Set([source.id]), new Set([source.name]));
    expect(copy.id).toBe("target-1");
    expect(copy.id).not.toBe(source.id);
    expect(copy.name).toBe("OSGameCoreOnly5");
    expect(copy.path).toBe("D:/workspace/OSGameCoreOnly5");
  });

  it("keeps bumping past names that are already used", () => {
    const copy = duplicateTarget(
      source,
      new Set([source.id, "osg-core-only5"]),
      new Set([source.name, "OSGameCoreOnly5"]),
    );
    expect(copy.name).toBe("OSGameCoreOnly6");
  });

  it("auto-assigns an id that avoids the taken set", () => {
    const copy = duplicateTarget(source, new Set(["target-1", "target-2"]), new Set());
    expect(copy.id).toBe("target-3");
  });

  it("falls back to a suffix when the name has no trailing number", () => {
    const plain: EditorTarget = { ...source, id: "trunk", name: "工作目录", path: "D:/trunk" };
    const copy = duplicateTarget(plain, new Set(["trunk"]), new Set(["工作目录"]));
    expect(copy.name).toBe("工作目录 副本");
    expect(copy.path).toBe("D:/trunk");
  });


  it("deep-copies steps so edits do not leak back to the source", () => {
    const copy = duplicateTarget(source, new Set(), new Set());
    (copy.steps[0].params as { deep: boolean }).deep = false;
    expect(source.steps[0].params.deep).toBe(true);
  });
});

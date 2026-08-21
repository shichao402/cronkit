import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  type Dispatch,
  type ReactNode,
} from "react";
import type { ConfigEditorPayload } from "../../shared/types";
import {
  createInitialState,
  editorReducer,
  validateDraftLocally,
  type EditorAction,
  type EditorState,
} from "./state";

type Host = {
  api: NonNullable<Window["api"]>;
  toast: (message: string, fail?: boolean) => void;
  onSaved: () => Promise<void>;
  onDirtyChange?: (dirty: boolean) => void;
};

type Ctx = {
  state: EditorState;
  dispatch: Dispatch<EditorAction>;
  host: Host;
  load: (focusTaskId?: string) => Promise<void>;
  save: (force?: boolean) => Promise<boolean>;
  discard: () => Promise<void>;
};

const EditorContext = createContext<Ctx | null>(null);

export function EditorProvider({ host, children }: { host: Host; children: ReactNode }) {
  const [state, dispatch] = useReducer(editorReducer, undefined, createInitialState);

  useEffect(() => {
    host.onDirtyChange?.(state.dirty);
  }, [host, state.dirty]);

  const load = useCallback(
    async (focusTaskId?: string) => {
      const payload: ConfigEditorPayload = await host.api.getConfigEditor();
      dispatch({ type: "LOAD", payload });
      if (focusTaskId && payload.draft?.tasks.some((t) => t.id === focusTaskId)) {
        dispatch({ type: "SELECT", selection: { kind: "task", taskId: focusTaskId } });
      }
    },
    [host],
  );

  const save = useCallback(
    async (force = false): Promise<boolean> => {
      if (!state.draft) {
        host.toast("没有可保存的配置", true);
        return false;
      }
      dispatch({ type: "SET_SAVING", saving: true });
      try {
        const local = validateDraftLocally(state.draft);
        if (local.length > 0) {
          dispatch({ type: "SET_ISSUES", issues: local });
          dispatch({ type: "SET_SAVING", saving: false });
          host.toast(local[0].message, true);
          return false;
        }
        const result = await host.api.saveConfigDraft(state.draft, state.revision, force);
        if (!result.ok) {
          if (result.reason === "conflict" && result.diskRevision && result.diskText) {
            dispatch({
              type: "SET_CONFLICT",
              conflict: { diskRevision: result.diskRevision, diskText: result.diskText },
            });
            host.toast("磁盘配置已变更，请处理冲突", true);
          } else {
            dispatch({
              type: "SET_ISSUES",
              issues: result.issues ?? [
                { path: "(root)", level: "error", message: result.error ?? "保存失败" },
              ],
            });
            host.toast(result.error ?? "保存失败", true);
          }
          dispatch({ type: "SET_SAVING", saving: false });
          return false;
        }
        const payload = await host.api.getConfigEditor();
        dispatch({ type: "LOAD", payload });
        await host.onSaved();
        host.toast("配置已保存并生效");
        return true;
      } catch (error) {
        host.toast(error instanceof Error ? error.message : String(error), true);
        dispatch({ type: "SET_SAVING", saving: false });
        return false;
      }
    },
    [host, state.draft, state.revision],
  );

  const discard = useCallback(async () => {
    if (state.dirty && !window.confirm("丢弃未保存的修改？")) {
      return;
    }
    await load();
  }, [load, state.dirty]);

  const value = useMemo(
    () => ({ state, dispatch, host, load, save, discard }),
    [state, host, load, save, discard],
  );

  return <EditorContext.Provider value={value}>{children}</EditorContext.Provider>;
}

export function useEditor(): Ctx {
  const ctx = useContext(EditorContext);
  if (!ctx) {
    throw new Error("useEditor must be used within EditorProvider");
  }
  return ctx;
}

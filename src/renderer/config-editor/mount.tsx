import { createRoot, type Root } from "react-dom/client";
import { ConfigEditorApp, syncDirtyAttr } from "./ConfigEditorApp";

type Host = {
  api: NonNullable<Window["api"]>;
  toast: (message: string, fail?: boolean) => void;
  onSaved: () => Promise<void>;
  onDirtyChange?: (dirty: boolean) => void;
};

let root: Root | null = null;
let hostRef: Host | null = null;
let focusTaskId: string | undefined;

export function mountConfigEditor(container: HTMLElement, host: Host): void {
  hostRef = {
    ...host,
    onDirtyChange: (dirty) => {
      syncDirtyAttr(container, dirty);
      host.onDirtyChange?.(dirty);
    },
  };
  if (!root) {
    root = createRoot(container);
  }
  render();
}

export function openConfigEditorReact(taskId?: string): void {
  focusTaskId = taskId;
  render();
}

export function isConfigEditorDirty(container: HTMLElement | null): boolean {
  return container?.dataset.dirty === "1";
}

function render(): void {
  if (!root || !hostRef) {
    return;
  }
  root.render(<ConfigEditorApp host={hostRef} focusTaskId={focusTaskId} />);
}

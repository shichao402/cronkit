import type { ConfigEditorPayload, EditorDraft, IconTheme, Snapshot } from "../shared/types";

export type DesktopApi = {
  getSnapshot: () => Promise<Snapshot>;
  runWorkspace: (id: string) => Promise<unknown>;
  cancelRun: (id: string) => Promise<unknown>;
  catchUp: () => Promise<unknown>;
  reloadConfig: () => Promise<Snapshot>;
  getConfigEditor: () => Promise<ConfigEditorPayload>;
  validateConfig: (text: string) => Promise<{ ok: boolean; error?: string }>;
  saveConfigText: (text: string) => Promise<Snapshot>;
  saveConfigDraft: (draft: EditorDraft) => Promise<Snapshot>;
  pickFolder: () => Promise<string | null>;
  openConfig: () => Promise<{ ok: boolean; error?: string }>;
  openLogs: () => Promise<{ ok: boolean; error?: string }>;
  openDataDir: () => Promise<{ ok: boolean; error?: string }>;
  setOpenAtLogin: (enabled: boolean) => Promise<unknown>;
  setSchedulerEnabled: (enabled: boolean) => Promise<unknown>;
  setIconTheme: (theme: IconTheme) => Promise<unknown>;
  updateToolset: (id: string) => Promise<Snapshot>;
  onSnapshot: (handler: (snapshot: Snapshot) => void) => () => void;
};

declare global {
  interface Window {
    api?: DesktopApi;
  }
}

export {};

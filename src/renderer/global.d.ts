import type { ConfigEditorPayload, EditorDraft, Snapshot, ThemePref } from "../shared/types";

export type DesktopApi = {
  getSnapshot: () => Promise<Snapshot>;
  runWorkspace: (id: string) => Promise<Snapshot>;
  cancelRun: (id: string) => Promise<void>;
  catchUp: () => Promise<Snapshot>;
  reloadConfig: () => Promise<Snapshot>;
  getConfigEditor: () => Promise<ConfigEditorPayload>;
  validateConfig: (text: string) => Promise<{ ok: boolean; error?: string }>;
  saveConfigText: (text: string) => Promise<Snapshot>;
  saveConfigDraft: (draft: EditorDraft) => Promise<Snapshot>;
  pickFolder: () => Promise<string | null>;
  openConfig: () => Promise<{ ok: boolean; error?: string }>;
  openLogs: () => Promise<{ ok: boolean; error?: string }>;
  openDataDir: () => Promise<{ ok: boolean; error?: string }>;
  setOpenAtLogin: (enabled: boolean) => Promise<void>;
  setSchedulerEnabled: (enabled: boolean) => Promise<void>;
  setTheme: (theme: ThemePref) => Promise<void>;
  updateToolset: (id: string) => Promise<Snapshot>;
  onSnapshot: (handler: (snapshot: Snapshot) => void) => () => void;
};

declare global {
  interface Window {
    api?: DesktopApi;
  }
}

export {};

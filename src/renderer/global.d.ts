import type {
  ConfigEditorPayload,
  EditorDraft,
  SaveConfigResult,
  Snapshot,
  ThemePref,
} from "../shared/types";

export type DesktopApi = {
  getSnapshot: () => Promise<Snapshot>;
  runWorkspace: (id: string) => Promise<Snapshot>;
  runTarget: (id: string) => Promise<Snapshot>;
  runTask: (id: string) => Promise<Snapshot>;
  cancelRun: (id: string) => Promise<void>;
  catchUp: () => Promise<Snapshot>;
  reloadConfig: () => Promise<Snapshot>;
  getConfigEditor: () => Promise<ConfigEditorPayload>;
  validateConfig: (text: string) => Promise<{ ok: boolean; error?: string }>;
  previewConfig: (text: string) => Promise<{
    ok: boolean;
    draft?: EditorDraft;
    error?: string;
    migratedFromV1?: boolean;
    migrationWarnings?: string[];
  }>;
  saveConfigText: (
    text: string,
    expectedRevision?: string,
    force?: boolean,
  ) => Promise<SaveConfigResult>;
  saveConfigDraft: (
    draft: EditorDraft,
    expectedRevision?: string,
    force?: boolean,
  ) => Promise<SaveConfigResult>;
  pickFolder: () => Promise<string | null>;
  openConfig: () => Promise<{ ok: boolean; error?: string }>;
  openLogs: () => Promise<{ ok: boolean; error?: string }>;
  openDataDir: () => Promise<{ ok: boolean; error?: string }>;
  setOpenAtLogin: (enabled: boolean) => Promise<void>;
  setSchedulerEnabled: (enabled: boolean) => Promise<void>;
  setTheme: (theme: ThemePref) => Promise<void>;
  setToolsetRepo: (id: string, repo: string) => Promise<Snapshot>;
  updateToolset: (id: string) => Promise<Snapshot>;
  onSnapshot: (handler: (snapshot: Snapshot) => void) => () => void;
};

declare global {
  interface Window {
    api?: DesktopApi;
  }
}

export {};

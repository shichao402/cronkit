import type { Snapshot } from "../shared/types";

export type DesktopApi = {
  getSnapshot: () => Promise<Snapshot>;
  runWorkspace: (id: string) => Promise<unknown>;
  cancelRun: (id: string) => Promise<unknown>;
  catchUp: () => Promise<unknown>;
  reloadConfig: () => Promise<Snapshot>;
  openConfig: () => Promise<{ ok: boolean; error?: string }>;
  openLogs: () => Promise<{ ok: boolean; error?: string }>;
  openDataDir: () => Promise<{ ok: boolean; error?: string }>;
  setOpenAtLogin: (enabled: boolean) => Promise<unknown>;
  setSchedulerEnabled: (enabled: boolean) => Promise<unknown>;
  onSnapshot: (handler: (snapshot: Snapshot) => void) => () => void;
};

declare global {
  interface Window {
    api?: DesktopApi;
  }
}

export {};

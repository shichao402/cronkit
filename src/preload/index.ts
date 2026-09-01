import { contextBridge, ipcRenderer } from "electron";
import type { UpdateStatus } from "../core/update/status";
import type {
  ConfigEditorPayload,
  EditorDraft,
  SaveConfigResult,
  Snapshot,
  ThemePref,
} from "../shared/types";

const api = {
  getSnapshot: (): Promise<Snapshot> => ipcRenderer.invoke("getSnapshot"),
  runWorkspace: (id: string) => ipcRenderer.invoke("runWorkspace", id),
  runTarget: (id: string) => ipcRenderer.invoke("runTarget", id),
  runTask: (id: string) => ipcRenderer.invoke("runTask", id),
  cancelRun: (id: string) => ipcRenderer.invoke("cancelRun", id),
  catchUp: () => ipcRenderer.invoke("catchUp"),
  reloadConfig: (): Promise<Snapshot> => ipcRenderer.invoke("reloadConfig"),
  getConfigEditor: (): Promise<ConfigEditorPayload> => ipcRenderer.invoke("getConfigEditor"),
  validateConfig: (text: string): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke("validateConfig", text),
  previewConfig: (text: string) => ipcRenderer.invoke("previewConfig", text),
  saveConfigText: (
    text: string,
    expectedRevision?: string,
    force?: boolean,
  ): Promise<SaveConfigResult> => ipcRenderer.invoke("saveConfigText", text, expectedRevision, force),
  saveConfigDraft: (
    draft: EditorDraft,
    expectedRevision?: string,
    force?: boolean,
  ): Promise<SaveConfigResult> =>
    ipcRenderer.invoke("saveConfigDraft", draft, expectedRevision, force),
  pickFolder: (): Promise<string | null> => ipcRenderer.invoke("pickFolder"),
  openConfig: (): Promise<{ ok: boolean; error?: string }> => ipcRenderer.invoke("openConfig"),
  openLogs: (): Promise<{ ok: boolean; error?: string }> => ipcRenderer.invoke("openLogs"),
  openDataDir: (): Promise<{ ok: boolean; error?: string }> => ipcRenderer.invoke("openDataDir"),
  setOpenAtLogin: (enabled: boolean) => ipcRenderer.invoke("setOpenAtLogin", enabled),
  setSchedulerEnabled: (enabled: boolean) => ipcRenderer.invoke("setSchedulerEnabled", enabled),
  setTheme: (theme: ThemePref) => ipcRenderer.invoke("setTheme", theme),
  setToolsetRepo: (id: string, repo: string): Promise<Snapshot> =>
    ipcRenderer.invoke("setToolsetRepo", id, repo),
  updateToolset: (id: string): Promise<Snapshot> => ipcRenderer.invoke("updateToolset", id),
  getUpdateStatus: (): Promise<UpdateStatus | null> => ipcRenderer.invoke("getUpdateStatus"),
  checkForUpdate: (): Promise<UpdateStatus | null> => ipcRenderer.invoke("checkForUpdate"),
  downloadUpdate: (): Promise<UpdateStatus | null> => ipcRenderer.invoke("downloadUpdate"),
  skipUpdate: (): Promise<UpdateStatus | null> => ipcRenderer.invoke("skipUpdate"),
  applyUpdate: (): Promise<{ ok: boolean; canceled?: boolean; error?: string }> =>
    ipcRenderer.invoke("applyUpdate"),
  revealUpdate: (): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke("revealUpdate"),
  openUpdateManualUrl: (): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke("openUpdateManualUrl"),
  onSnapshot: (handler: (snapshot: Snapshot) => void): (() => void) => {
    const listener = (_event: unknown, snapshot: Snapshot): void => handler(snapshot);
    ipcRenderer.on("snapshot", listener);
    return () => ipcRenderer.removeListener("snapshot", listener);
  },
  onUpdateStatus: (handler: (status: UpdateStatus) => void): (() => void) => {
    const listener = (_event: unknown, status: UpdateStatus): void => handler(status);
    ipcRenderer.on("updateStatus", listener);
    return () => ipcRenderer.removeListener("updateStatus", listener);
  },
};

contextBridge.exposeInMainWorld("api", api);

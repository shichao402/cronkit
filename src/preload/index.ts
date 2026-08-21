import { contextBridge, ipcRenderer } from "electron";
import type { ConfigEditorPayload, EditorDraft, IconTheme, Snapshot } from "../shared/types";

const api = {
  getSnapshot: (): Promise<Snapshot> => ipcRenderer.invoke("getSnapshot"),
  runWorkspace: (id: string) => ipcRenderer.invoke("runWorkspace", id),
  cancelRun: (id: string) => ipcRenderer.invoke("cancelRun", id),
  catchUp: () => ipcRenderer.invoke("catchUp"),
  reloadConfig: (): Promise<Snapshot> => ipcRenderer.invoke("reloadConfig"),
  getConfigEditor: (): Promise<ConfigEditorPayload> => ipcRenderer.invoke("getConfigEditor"),
  validateConfig: (text: string): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke("validateConfig", text),
  saveConfigText: (text: string): Promise<Snapshot> => ipcRenderer.invoke("saveConfigText", text),
  saveConfigDraft: (draft: EditorDraft): Promise<Snapshot> => ipcRenderer.invoke("saveConfigDraft", draft),
  pickFolder: (): Promise<string | null> => ipcRenderer.invoke("pickFolder"),
  openConfig: (): Promise<{ ok: boolean; error?: string }> => ipcRenderer.invoke("openConfig"),
  openLogs: (): Promise<{ ok: boolean; error?: string }> => ipcRenderer.invoke("openLogs"),
  openDataDir: (): Promise<{ ok: boolean; error?: string }> => ipcRenderer.invoke("openDataDir"),
  setOpenAtLogin: (enabled: boolean) => ipcRenderer.invoke("setOpenAtLogin", enabled),
  setSchedulerEnabled: (enabled: boolean) => ipcRenderer.invoke("setSchedulerEnabled", enabled),
  setIconTheme: (theme: IconTheme) => ipcRenderer.invoke("setIconTheme", theme),
  updateToolset: (id: string): Promise<Snapshot> => ipcRenderer.invoke("updateToolset", id),
  onSnapshot: (handler: (snapshot: Snapshot) => void): (() => void) => {
    const listener = (_event: unknown, snapshot: Snapshot): void => handler(snapshot);
    ipcRenderer.on("snapshot", listener);
    return () => ipcRenderer.removeListener("snapshot", listener);
  },
};

contextBridge.exposeInMainWorld("api", api);

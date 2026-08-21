import { contextBridge, ipcRenderer } from "electron";
import type { Snapshot } from "../shared/types";

const api = {
  getSnapshot: (): Promise<Snapshot> => ipcRenderer.invoke("getSnapshot"),
  runWorkspace: (id: string) => ipcRenderer.invoke("runWorkspace", id),
  cancelRun: (id: string) => ipcRenderer.invoke("cancelRun", id),
  catchUp: () => ipcRenderer.invoke("catchUp"),
  reloadConfig: (): Promise<Snapshot> => ipcRenderer.invoke("reloadConfig"),
  openConfig: (): Promise<{ ok: boolean; error?: string }> => ipcRenderer.invoke("openConfig"),
  openLogs: (): Promise<{ ok: boolean; error?: string }> => ipcRenderer.invoke("openLogs"),
  openDataDir: (): Promise<{ ok: boolean; error?: string }> => ipcRenderer.invoke("openDataDir"),
  setOpenAtLogin: (enabled: boolean) => ipcRenderer.invoke("setOpenAtLogin", enabled),
  setSchedulerEnabled: (enabled: boolean) => ipcRenderer.invoke("setSchedulerEnabled", enabled),
  updateToolset: (id: string): Promise<Snapshot> => ipcRenderer.invoke("updateToolset", id),
  onSnapshot: (handler: (snapshot: Snapshot) => void): (() => void) => {
    const listener = (_event: unknown, snapshot: Snapshot): void => handler(snapshot);
    ipcRenderer.on("snapshot", listener);
    return () => ipcRenderer.removeListener("snapshot", listener);
  },
};

contextBridge.exposeInMainWorld("api", api);

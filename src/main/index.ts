import { app, BrowserWindow, ipcMain, Menu, Notification, Tray, nativeImage } from "electron";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { ensureUserConfig } from "../core/bootstrap";
import { Orchestrator } from "../core/orchestrator";
import { defaultDataDir } from "../core/paths";
import type { Snapshot } from "../shared/types";
import { openPathReliable } from "./open-path";

let tray: Tray | undefined;
let window: BrowserWindow | undefined;
let orch: Orchestrator;
let quitting = false;

function resource(...parts: string[]): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, ...parts);
  }
  return path.join(app.getAppPath(), "resources", ...parts);
}

function iconFor(state: Snapshot["appState"]) {
  const file = state === "running" ? "icon-running.png" : state === "failed" ? "icon-failed.png" : "icon-idle.png";
  const image = nativeImage.createFromPath(resource(file));
  if (image.isEmpty()) {
    return nativeImage.createFromPath(resource("icon-idle.png"));
  }
  return image;
}

function preloadPath(): string {
  return path.join(__dirname, "../preload/index.cjs");
}

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 980,
    height: 680,
    minWidth: 840,
    minHeight: 540,
    title: "工作目录编排器",
    backgroundColor: "#121417",
    autoHideMenuBar: true,
    icon: resource("icon-idle.png"),
    webPreferences: {
      preload: preloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  win.on("close", (event) => {
    if (!quitting && !process.argv.includes("--self-test")) {
      event.preventDefault();
      win.hide();
    }
  });
  if (process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void win.loadFile(path.join(__dirname, "../renderer/index.html"));
  }
  return win;
}

function pushSnapshot(): void {
  if (!window || window.isDestroyed()) {
    return;
  }
  const snap = orch.snapshot();
  window.webContents.send("snapshot", snap);
  tray?.setImage(iconFor(snap.appState));
  const label =
    snap.appState === "running" ? "运行中" : snap.appState === "failed" ? "有失败" : "空闲";
  tray?.setToolTip(`工作目录编排器 · ${label}`);
}

function showWindow(): void {
  if (!window || window.isDestroyed()) {
    window = createWindow();
    window.webContents.on("did-finish-load", () => {
      pushSnapshot();
      if (process.argv.includes("--self-test")) {
        void runSelfTest(window!);
      }
    });
  }
  window.show();
  window.focus();
}

async function runSelfTest(win: BrowserWindow): Promise<void> {
  const resultFile = path.join(app.getAppPath(), "self-test-result.json");
  try {
    await new Promise((resolve) => setTimeout(resolve, 800));
    const result = await win.webContents.executeJavaScript(`
      (async () => {
        const hasApi = typeof window.api === "object" && window.api !== null;
        const keys = hasApi ? Object.keys(window.api) : [];
        let snapshot = null;
        let reload = null;
        let openConfig = null;
        const errors = [];
        try {
          if (hasApi) snapshot = await window.api.getSnapshot();
        } catch (error) {
          errors.push("getSnapshot: " + error);
        }
        try {
          if (hasApi) reload = await window.api.reloadConfig();
        } catch (error) {
          errors.push("reloadConfig: " + error);
        }
        try {
          if (hasApi) openConfig = await window.api.openConfig();
        } catch (error) {
          errors.push("openConfig: " + error);
        }
        return {
          hasApi,
          keys,
          subtitle: document.getElementById("subtitle")?.textContent ?? "",
          workspaceCount: snapshot?.workspaces?.length ?? 0,
          configError: snapshot?.configError ?? "",
          openConfig,
          errors,
        };
      })()
    `);
    writeFileSync(resultFile, JSON.stringify({ ok: result.hasApi && result.workspaceCount > 0, ...result }, null, 2), "utf8");
  } catch (error) {
    writeFileSync(
      resultFile,
      JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }, null, 2),
      "utf8",
    );
  } finally {
    quitting = true;
    orch.stop();
    app.quit();
  }
}

function setupTray(): void {
  tray = new Tray(iconFor("idle"));
  const menu = Menu.buildFromTemplate([
    { label: "打开面板", click: () => showWindow() },
    { label: "立即补跑", click: () => orch.catchUpNow() },
    { type: "separator" },
    {
      label: "退出",
      click: () => {
        quitting = true;
        orch.stop();
        app.quit();
      },
    },
  ]);
  tray.setContextMenu(menu);
  tray.on("click", () => showWindow());
}

function applyOpenAtLogin(enabled: boolean): void {
  orch.openAtLogin = enabled;
  app.setLoginItemSettings({
    openAtLogin: enabled,
    enabled,
    path: process.execPath,
    args: app.isPackaged ? ["--hidden"] : [app.getAppPath(), "--hidden"],
  });
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => showWindow());
  app.whenReady().then(() => {
    app.setAppUserModelId("com.agentshelpme.workspace-orchestrator");
    const dataDir = defaultDataDir();
    const configPath = ensureUserConfig(dataDir);
    orch = new Orchestrator({ configPath, dataDir });
    const login = app.getLoginItemSettings();
    orch.openAtLogin = login.openAtLogin;
    orch.on("change", () => pushSnapshot());
    orch.on("runFinished", (run) => {
      if (window?.isVisible()) {
        return;
      }
      new Notification({
        title: run.status === "succeeded" ? "任务完成" : "任务未成功",
        body: `${run.workspaceName} · ${run.status}`,
      }).show();
    });
    orch.start();
    setupTray();
    ipcMain.handle("getSnapshot", () => orch.snapshot());
    ipcMain.handle("runWorkspace", (_e, id: string) => {
      void orch.runWorkspace(id, "manual").catch(() => undefined);
      return orch.snapshot();
    });
    ipcMain.handle("cancelRun", (_e, id: string) => {
      orch.cancelRun(id);
    });
    ipcMain.handle("catchUp", () => {
      orch.catchUpNow();
      return orch.snapshot();
    });
    ipcMain.handle("reloadConfig", () => {
      orch.reloadConfig();
      return orch.snapshot();
    });
    ipcMain.handle("openConfig", () => openPathReliable(orch.configPath, "file"));
    ipcMain.handle("openLogs", () => openPathReliable(path.join(orch.dataDir, "logs"), "dir"));
    ipcMain.handle("openDataDir", () => openPathReliable(orch.dataDir, "dir"));
    ipcMain.handle("setOpenAtLogin", (_e, enabled: boolean) => {
      applyOpenAtLogin(enabled);
      pushSnapshot();
    });
    ipcMain.handle("setSchedulerEnabled", (_e, enabled: boolean) => {
      orch.setSchedulerEnabled(enabled);
    });

    const hidden = process.argv.includes("--hidden") && orch.store.data.schedulerEnabled;
    if (!hidden || process.argv.includes("--self-test")) {
      showWindow();
    }
    pushSnapshot();
  });
}

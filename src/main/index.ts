import { app, BrowserWindow, dialog, ipcMain, Menu, Notification, Tray, nativeImage, nativeTheme } from "electron";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { ensureUserConfig } from "../core/bootstrap";
import { Orchestrator } from "../core/orchestrator";
import { defaultDataDir } from "../core/paths";
import { installOrUpdateToolset, rememberToolsetSha } from "../core/toolset";
import type { ResolvedTheme, Snapshot, ThemePref, TrayState } from "../shared/types";
import { openPathReliable } from "./open-path";

let tray: Tray | undefined;
let window: BrowserWindow | undefined;
let orch: Orchestrator;
let quitting = false;
let appliedTheme: ResolvedTheme | undefined;
let appliedPref: ThemePref | undefined;

// Must match the --bg token per theme in renderer/styles.css, or the window flashes on load.
const WINDOW_BG: Record<ResolvedTheme, string> = {
  dark: "#121417",
  light: "#f4f6f8",
};

function resource(...parts: string[]): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, ...parts);
  }
  return path.join(app.getAppPath(), "resources", ...parts);
}

function currentTheme(): ResolvedTheme {
  return orch?.resolvedTheme() ?? "dark";
}

// Scheduler off is not the same thing as nothing to do, so the tray tells them apart.
function trayStateOf(snap: Snapshot): TrayState {
  if (snap.appState === "running") {
    return "running";
  }
  if (snap.appState === "failed") {
    return "failed";
  }
  return snap.schedulerEnabled ? "idle" : "paused";
}

function trayIcon(theme: ResolvedTheme, state: TrayState) {
  const image = nativeImage.createFromPath(resource(`tray-${theme}-${state}.png`));
  if (image.isEmpty()) {
    return nativeImage.createFromPath(resource("tray-light-idle.png"));
  }
  return image;
}

function appIcon(theme: ResolvedTheme) {
  const image = nativeImage.createFromPath(resource(`app-${theme}.png`));
  if (image.isEmpty()) {
    return nativeImage.createFromPath(resource("app-light.png"));
  }
  return image;
}

function preloadPath(): string {
  return path.join(__dirname, "../preload/index.cjs");
}

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1100,
    height: 760,
    minWidth: 920,
    minHeight: 600,
    title: "工作目录编排器",
    backgroundColor: WINDOW_BG[currentTheme()],
    autoHideMenuBar: true,
    icon: appIcon(currentTheme()),
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
  const snap = orch.snapshot();
  if (window && !window.isDestroyed()) {
    window.webContents.send("snapshot", snap);
  }
  applyTheme(snap);
}

const TRAY_LABELS: Record<TrayState, string> = {
  idle: "空闲",
  running: "运行中",
  failed: "有失败",
  paused: "已停用",
};

const THEME_LABELS: Record<ThemePref, string> = {
  system: "跟随系统",
  light: "浅色",
  dark: "深色",
};

function applyTheme(snap: Snapshot): void {
  const state = trayStateOf(snap);
  tray?.setImage(trayIcon(snap.resolvedTheme, state));
  tray?.setToolTip(`工作目录编排器 · ${TRAY_LABELS[state]}`);
  if (snap.resolvedTheme !== appliedTheme) {
    appliedTheme = snap.resolvedTheme;
    if (window && !window.isDestroyed()) {
      window.setIcon(appIcon(snap.resolvedTheme));
      window.setBackgroundColor(WINDOW_BG[snap.resolvedTheme]);
    }
  }
  if (snap.theme !== appliedPref) {
    appliedPref = snap.theme;
    applyTrayMenu();
  }
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

function applyTrayMenu(): void {
  if (!tray) {
    return;
  }
  const pref = orch.store.data.theme;
  const menu = Menu.buildFromTemplate([
    { label: "打开面板", click: () => showWindow() },
    { label: "立即补跑", click: () => orch.catchUpNow() },
    { type: "separator" },
    {
      label: "主题",
      submenu: (["system", "light", "dark"] as ThemePref[]).map((value) => ({
        label: THEME_LABELS[value],
        type: "radio" as const,
        checked: pref === value,
        click: () => orch.setTheme(value),
      })),
    },
    { type: "separator" },
    {
      label: "退出",
      click: () => {
        const snap = orch.snapshot();
        if (snap.exitWarnsRunning) {
          // Electron has no sync confirm in tray; log and quit anyway — panel shows the warn.
          console.warn("退出时仍有运行中的任务，将被中断");
        }
        quitting = true;
        orch.stop();
        app.quit();
      },
    },
  ]);
  tray.setContextMenu(menu);
}

function setupTray(): void {
  tray = new Tray(trayIcon(currentTheme(), "idle"));
  applyTrayMenu();
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
    app.setAppUserModelId("com.agentshelpme.cronkit");
    const dataDir = defaultDataDir();
    const configPath = ensureUserConfig(dataDir);
    orch = new Orchestrator({ configPath, dataDir });
    orch.systemTheme = nativeTheme.shouldUseDarkColors ? "dark" : "light";
    nativeTheme.on("updated", () => {
      const next = nativeTheme.shouldUseDarkColors ? "dark" : "light";
      if (next === orch.systemTheme) {
        return;
      }
      orch.systemTheme = next;
      if (orch.store.data.theme === "system") {
        pushSnapshot();
      }
    });
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
      void orch.runTarget(id, "manual").catch(() => undefined);
      return orch.snapshot();
    });
    ipcMain.handle("runTarget", (_e, id: string) => {
      void orch.runTarget(id, "manual").catch(() => undefined);
      return orch.snapshot();
    });
    ipcMain.handle("runTask", (_e, id: string) => {
      void orch.runTask(id, "manual").catch(() => undefined);
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
    ipcMain.handle("getConfigEditor", () => orch.getConfigEditor());
    ipcMain.handle("validateConfig", (_e, text: string) => orch.validateConfigText(text));
    ipcMain.handle("previewConfig", (_e, text: string) => orch.previewConfigText(text));
    ipcMain.handle(
      "saveConfigText",
      (_e, text: string, expectedRevision?: string, force?: boolean) =>
        orch.saveConfigTextResult(text, expectedRevision, force === true),
    );
    ipcMain.handle(
      "saveConfigDraft",
      (_e, draft, expectedRevision?: string, force?: boolean) =>
        orch.saveConfigDraftResult(draft, expectedRevision, force === true),
    );
    ipcMain.handle("pickFolder", async (event) => {
      const win = BrowserWindow.fromWebContents(event.sender);
      const options = { properties: ["openDirectory" as const] };
      const result = win
        ? await dialog.showOpenDialog(win, options)
        : await dialog.showOpenDialog(options);
      if (result.canceled || result.filePaths.length === 0) {
        return null;
      }
      return result.filePaths[0];
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
    ipcMain.handle("setTheme", (_e, theme: ThemePref) => {
      orch.setTheme(theme === "dark" || theme === "light" ? theme : "system");
    });
    ipcMain.handle("updateToolset", async (_e, id: string) => {
      const info = await installOrUpdateToolset(id, orch.dataDir);
      if (info.sha) {
        rememberToolsetSha(id, info.sha, orch.dataDir);
      }
      orch.reloadConfig();
      return orch.snapshot();
    });

    const hidden = process.argv.includes("--hidden") && orch.store.data.schedulerEnabled;
    if (!hidden || process.argv.includes("--self-test")) {
      showWindow();
    }
    pushSnapshot();
  });
}

# 0003. Windows 任务栏图标以打包 exe 内嵌资源为准

- 状态：accepted
- 日期：2026-08-21

## 背景

开发态 `npm start` 跑的是 `electron.exe`。`BrowserWindow({ icon })` / `setIcon` 只影响**未固定**时的窗口按钮。一旦固定到任务栏，Windows 用指向该 exe 的快捷方式，图标取 exe 内嵌资源，跳转列表标题也是 exe 的文件描述（开发态就是 “Electron”）。

## 决定

- 开发态：接受固定后显示 Electron 默认图标；不为此改 electron.exe。
- 发布态：`electron-builder.yml` 的 `win.icon`（`build/icon.png`）打进 `WorkspaceOrchestrator.exe`。要看「固定后的图标」，从 `dist\win-unpacked\WorkspaceOrchestrator.exe` 固定。
- 运行时 `resources/app-*.png` 只服务窗口图标和主题切换。固定项是静态的，不跟浅色/深色主题变。

## 备选

- 给开发态做一份带图标的 electron 包装 exe：维护成本高，和真实发布路径不一致。
- 只用 `setAppUserModelId` 换图标：AppUserModelID 管分组和通知，不管 exe 资源。

## 后果

改品牌图标时同时改 `design/icon/`（源稿）、`resources/app-*.png`（窗口）和 `build/icon.png`（exe）。重新打包后若固定项仍是旧图，先取消固定再固定，或刷新 Windows 图标缓存。

# 0004. 用户数据目录与应用身份对齐为 `cronkit`

- 状态：accepted
- 日期：2026-08-21

## 背景

仓库已叫 `cronkit`，面板品牌也是 Cronkit。运行时数据仍写在 `%APPDATA%\workspace-orchestrator\`，Electron `package.json` 的 `name`、Windows `AppUserModelID`、builder `appId` 也沿用旧名。三套名字并存，设置页的「文件位置」会误导。

## 决定

- 用户数据目录：`%APPDATA%\cronkit\`（`config.yaml`、`state.json`、`logs/`、`toolsets/`）。
- `package.json` `name`、`app.setAppUserModelId`、`electron-builder.yml` `appId` 一律为 `cronkit` / `com.agentshelpme.cronkit`。
- 窗口与托盘展示名仍是「工作目录编排器」；打包 exe 仍是 `WorkspaceOrchestrator.exe`（任务栏固定项见 [0003](0003-windows-taskbar-icon.md)）。
- 首次启动若新目录还没有 `config.yaml`、旧目录有，则拷贝配置、状态、日志和 toolset，并把配置里指向旧 AppData 的路径改成新目录。不搬 Chromium 缓存。

## 备选

- 只改展示文案、目录仍叫 `workspace-orchestrator`：设置页路径继续和仓库名打架。
- 连 exe / 中文产品名一起改成 Cronkit：任务栏固定项和已分发的 exe 会断，这次只收数据目录和应用 ID。

## 后果

已安装用户重启一次即可迁到新目录。旧 `%APPDATA%\workspace-orchestrator` 可在确认新目录正常后手动删除。改 `appId` 后，Windows 会把它当成新应用分组；若任务栏钉的是旧 ID，需重新固定。

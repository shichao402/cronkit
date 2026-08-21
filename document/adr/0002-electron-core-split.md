# 0002. Electron 壳 + 无 Electron 依赖的 `src/core`

- 状态：accepted
- 日期：2026-08-21

## 背景

产品是 Windows 托盘程序：YAML 调度 SVN / Unity / 本地脚本。调度、占用探测、toolset 执行必须能在没有窗口的情况下跑，CLI 和自测也不能绑死 GUI。

## 决定

- `src/main`：Electron 主进程（窗口、托盘、IPC、开机启动、通知）。
- `src/preload` + `src/renderer`：面板 UI。
- `src/core`：编排器、配置、store、toolset、计划任务。**不 import electron**。
- `src/cli.ts`：同一套 core 的命令行入口。
- `src/shared`：主进程和渲染进程共用的类型。

运行时数据在 `%APPDATA%\workspace-orchestrator\`（`config.yaml`、`state.json`、`logs/`、`toolsets/`）。首次启动由 core 探测本机工作副本并生成配置；默认**不**打开自动调度。

## 备选

- 调度逻辑写在 main 里：CLI 和自测都要起 Electron，core 也难测。
- 做成纯服务/无 UI：本机占用探测和「看一眼再启用调度」需要面板。

## 后果

主题、托盘图标、`nativeTheme` 由 main 注入 core（例如 `systemTheme`），core 只消费已解析的值。新增步骤走 toolset，而不是在 main 里直接 spawn。

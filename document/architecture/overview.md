# 架构概览

Windows 托盘调度器：读 YAML，按 cron 对若干工作目录跑步骤（SVN、Unity 预热、外部 toolset、空闲退出等）。关窗口进托盘，不退出进程。

## 进程与模块

```
┌─────────────────────────────────────────┐
│ renderer  面板 / 配置编辑                 │
│ preload   contextIsolation IPC           │
└─────────────────┬───────────────────────┘
                  │ ipcMain.handle
┌─────────────────▼───────────────────────┐
│ main      单实例、托盘、窗口、通知、开机启动 │
│           把 nativeTheme 写入 Orchestrator │
└─────────────────┬───────────────────────┘
                  │
┌─────────────────▼───────────────────────┐
│ core      Orchestrator / Store / Config   │
│           plan · occupants · toolset      │
└─────────────────────────────────────────┘
         CLI (src/cli.ts) 走同一套 core
```

`src/core` 不引用 electron，详见 [ADR 0002](../adr/0002-electron-core-split.md)。

## 运行时数据

| 路径 | 内容 |
| --- | --- |
| `%APPDATA%\workspace-orchestrator\config.yaml` | 用户配置；首次启动探测本机 SVN 工作副本生成 |
| `state.json` | 调度开关、主题、最近 run |
| `logs/<date>/<runId>/` | 步骤日志 |
| `toolsets/<id>/` | 外部 toolset 检出（如 OSGToolset） |

默认 `schedulerEnabled = false`，避免未确认就 `svn update`。`maxConcurrentRuns` 默认 1；同一规范化路径不会并行跑。

## 一次调度

1. `plan` 按 cron + timezone 算下次触发。
2. 到期入队；`occupants` 必要时清占用（脚本在 `scripts/`）。
3. 每个 workspace 的 steps 经 toolset 规范化后执行（builtin 或外部 manifest）。
4. 结果写入 store 与日志；窗口不可见时失败/完成可弹通知。
5. 面板只消费 `Snapshot`，不直接跑命令。

## 图标

两套用途，不要混：

- 窗口 / 主题：`resources/app-*.png`，main 里 `setIcon`。
- 任务栏固定项 / 跳转列表：打包进 exe 的 `build/icon.png`。

开发态固定的是 `electron.exe`，会显示 Electron 默认图标，见 [ADR 0003](../adr/0003-windows-taskbar-icon.md)。

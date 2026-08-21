# 目录约定

```
cronkit/
  document/                 项目文档（只放这里）
    adr/                    已拍板的决定
    architecture/           当前怎么工作
    roadmap/                规划与缺口
  scripts/                  可执行脚本（安装、探测、fixture），不是文档
  src/
    main/                   Electron 主进程
    preload/
    renderer/               面板（正式入口；配置页为 React）
      config-editor/        任务优先配置编辑器
    core/                   编排；禁止依赖 electron
    cli.ts
    shared/                 跨进程类型 / draft YAML
  tools/
    ui-preview/             浏览器 mock 面板；独立 Vite，不进 Electron 打包
  design/icon/              图标源稿（大图）
  resources/                开发态 / extraResources 用的 png
  build/                    electron-builder 打包资源（含 win.icon）
  config.demo.yaml          仓库内演示配置
```

运行时用户数据不进仓库：`%APPDATA%\cronkit\`。

## 放哪里

| 东西 | 位置 |
| --- | --- |
| 为什么这么设计 | `document/adr/` |
| 现在分层、数据流、目录 | `document/architecture/` |
| 下一步、明确不做 | `document/roadmap/` |
| 用户怎么启动、打包、CLI | 根 `README.md` |
| PowerShell / 安装脚本 | `scripts/` |
| 调度与步骤实现 | `src/core/` |
| 窗口、托盘、IPC | `src/main/` |
| 浏览器 mock 面板 | `tools/ui-preview/`（`npm run ui-preview`） |

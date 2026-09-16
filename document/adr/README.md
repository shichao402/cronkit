# ADR

Architecture Decision Record。一条 ADR 只记**一个**决定：当时面对什么约束、选了什么、放弃了什么、后果是什么。

## 怎么写

1. 复制 [TEMPLATE.md](TEMPLATE.md)。
2. 文件名：`NNNN-短横线英文标题.md`，序号递增，不要改已有编号。
3. 状态只用：`proposed` / `accepted` / `superseded by NNNN` / `deprecated`。
4. 决定被推翻时：新开一条，旧条改成 `superseded`，不要改写旧文伪装成一直如此。

## 索引

| 编号 | 标题 | 状态 |
| --- | --- | --- |
| [0001](0001-project-document-layout.md) | 用 `document/{adr,architecture,roadmap}` 存项目文档 | accepted |
| [0002](0002-electron-core-split.md) | Electron 壳 + 无 Electron 依赖的 `src/core` | accepted |
| [0003](0003-windows-taskbar-icon.md) | Windows 任务栏图标以打包 exe 内嵌资源为准 | accepted |
| [0004](0004-user-data-dir-cronkit.md) | 用户数据目录与应用身份对齐为 `cronkit` | accepted |
| [0005](0005-task-first-config-react-editor.md) | Task-first config v2 + React 配置编辑器 | accepted |
| [0006](0006-full-react-form-only-panel.md) | 全站 React 壳 + 表单唯一配置编辑 | accepted |
| [0007](0007-svn-write-lock-release.md) | SVN 写集驱动的 Windows 文件独占处理 | accepted |
| [0008](0008-toolset-checkout-resets-to-remote.md) | 工具集检出更新时以远端为准 | accepted |
| [0009](0009-step-templates-and-auto-ids.md) | 可复用步骤模板 + id 由程序自动分配 | accepted |
| [0010](0010-relkit-node-sdk-and-onboard.md) | 接入 relkit 自动更新：自研 Node SDK + 按 RUP 标准开箱 | superseded by 0012 |
| [0011](0011-versioned-dir-apply.md) | Windows 更新采用稳定 launcher + versionedDir | accepted |
| [0012](0012-relkit-updater-sidecar.md) | 自动更新经单一 relkit-updater sidecar | accepted |


# 0011. Windows 更新采用稳定 launcher + versionedDir

- 状态：accepted
- 日期：2026-09-01
- 上游决定：[ADR 0010](0010-relkit-node-sdk-and-onboard.md)

## 背景

cronkit 是常驻托盘的 Electron 应用。Windows 会锁住运行中的 exe 与部分资源，不能由
应用本身原地覆盖。`rup-client` 只负责 check / download / 校验，不提供 apply；
relkit 的 `relkit-apply` 只实现 `versionedDir`，要求宿主提供稳定 launcher。

旧版安装是一层 `win-unpacked`。改造还必须允许旧版直接迁移，不能要求用户先手工安装
一个过渡版本。

## 决定

发布包改成以下布局：

```text
<installDir>/
  WorkspaceOrchestrator.exe
  relkit-apply.exe
  active.json
  versions/<version>/WorkspaceOrchestrator.exe
```

根 exe 是用 Go 标准库构建的极小 launcher，只读取 `active.json`，确认目标路径没有
逃出安装根后转发全部参数。Electron 应用始终位于版本目录。

安装流程为：

1. `rup-client` 下载并校验完整 ZIP。
2. 用户确认且编排器无运行任务后，主进程解包到 `%APPDATA%/cronkit/update-staging/`。
3. 独立 PowerShell 等待主进程完全退出，再调用固定到
   `b255ad090bde4134780202a9edc4fede8ec129fe` 的 `relkit-apply`。
4. sidecar 先完整复制新版本，再原子切换 `active.json`，保留当前与上一个版本并重启根 launcher。

首次从单层安装迁移时，安装根仍是当前 exe 的父目录；主进程退出后 sidecar 将根 exe
替换为 launcher。后续版本从 `versions/<version>/` 反推同一个稳定安装根。

开机自启注册稳定 launcher，而不是版本目录下的 Electron exe。单实例锁继续由相同
应用身份和用户数据目录提供；资源仍从当前版本的 `process.resourcesPath` 读取。

## 备选

- 应用内原地覆盖：Windows 文件锁下不能可靠完成，拒绝。
- PowerShell / cmd 直接作为 launcher：自启、图标和参数转发体验差，拒绝。
- 再打包一份 Electron launcher：会重复携带 Chromium，体积与攻击面都不合理，拒绝。
- 自写 apply：会复制上游已经处理的切换契约，容易产生不兼容，拒绝。

## 后果

- Windows 发布机除 Node 工具链外还需要 Go；构建脚本会固定提交构建 launcher 与 sidecar。
- 发布 artifact 必须是 versionedDir ZIP，普通 `win-unpacked` 不再是可发布产物。
- 新版本复制失败时不会切换 `active.json`；apply session 按 versionedDir 契约位于
  `<installDir>/update_apply.json`，失败会在下次启动显示。日志位于
  `%APPDATA%/cronkit/logs/update-apply.log`。
- 根 launcher 与 sidecar 可随新包刷新；运行中的 sidecar 若暂时无法替换自身，只影响
  sidecar 升级，不影响本次 `active.json` 切换。

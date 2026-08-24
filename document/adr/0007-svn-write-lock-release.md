# 0007. SVN 写集驱动的 Windows 文件独占处理

- 状态：accepted
- 日期：2026-08-24

## 背景

Windows 上 `svn update` / `revert` 要改写、移动文件时，只要目标被其它进程独占，操作会失败，并经常留下 `.svn/lock`，工作副本卡住。已有 `occupants` 在独占步骤前按**工作副本路径 / wc.db / Unity 进程名**清占用，但 Restart Manager 只对登记过的路径有效：目录根和 `wc.db` 查不到「即将被 SVN 改写的那一批 dll/资源」。

`svn status` 能看到本地脏文件（revert 会动它们）；`svn status -u` 能把远端差异叠到本地，得到「若完成更新，哪些路径会被写入」。

不是所有场景都该强杀占用进程（白天开着 Rider/资源管理器），所以释放必须可选。

## 决定

1. **预测写集**：update 用 `svn status -u --xml` 的 `repos-status`；revert 用本地 `wc-status` 非 normal。始终把 `.svn/wc.db` 等元数据列入探测。
2. **按写集查占用**：把预测路径交给 `list-occupants.ps1` 的 Restart Manager（分批），只结束真正握住这些文件的进程。IDE（Rider 等）仍只请求正常退出，不强制杀。
3. **可选**：`builtin/svn-update` 与 `svn-revert` 的 `with.releaseOccupants` 默认 `true`；设为 `false` 则只报告写集、不杀进程。与 `runtime.releaseOccupants`（任务开始时清 Unity / 目录占用）是两层：运行时关的是粗粒度独占，步骤关的是 SVN 写集这一层。
4. **失败重试**：update 若报共享冲突 / 文件正在使用，且步骤允许释放：先 `cleanup`，再按写集+错误里的路径释放，然后重试一次 update。**不**在这一条重试路径上自动 `revert`（那仍只由 `onConflict: revert` 决定）。

## 备选

- 只靠现有目录级 RM / Unity 按名强杀：漏掉被占用的生成物二进制，更新失败后 WC 锁死。
- 更新前无条件结束所有命令行含工程路径的进程：误杀过多；现有过滤已经故意忽略多数 cmdline 命中。
- 默认关闭写集释放：夜间无人值守时最常见的失败就是独占，默认打开、步骤可关更合适。

## 后果

- 预检 / dry-run 会附带「将写入 N 个路径」以及当前占用进程（Windows）。
- 写集过大时最多探测 2048 个路径，二进制/锁文件优先。
- 步骤打开释放时，握住写集的 Unity 仍会被 RM 找到并按原规则结束；不会仅因「机器上有 Unity」就按进程名全杀。

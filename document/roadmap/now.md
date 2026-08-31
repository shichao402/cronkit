# Roadmap

只记还没做完、或明确不做的事。做成了就删条目，需要留「为什么」的搬到 ADR。

## 近期

- 用 `npm run dist` 验证打包后的任务栏固定图标与跳转列表名称（`WorkspaceOrchestrator` / 工作目录编排器），不以 `npm start` 的固定项为准。
- 保持 `document/` 三块同步：目录或分层一变，先改 architecture，决策则补 ADR。
- 仪表盘可进一步改成「按任务分组」列表（当前仍是 target 扁平行 + task 名芯片）。
- 接入 relkit 自动更新：Node SDK（relkit 仓库 `sdk/node`，包 `rup-client`）、本仓工具链开箱、主进程 check/download + 设置页 UI 均**已完成**，跨实现闭环冒烟已过。剩余：versionedDir apply 改造、COS 后端真实发版、公钥轮换流程成文。见 [ADR 0010](../adr/0010-relkit-node-sdk-and-onboard.md) 与 [计划](relkit-onboard-plan.md)。relkit 侧改动**仍未提交**，清单在计划 §5，交由 relkit 自行核对。
- 接入 Agent：优先覆盖「规划不清晰 / 分支多 / 异常多」的流程，先能交给 Agent 处理，再逐步沉淀规律并固化为确定性步骤；接入方式暂定 **CodeBuddy SDK**（不用 OpenAI / Claude 系列 API）。

## 已知缺口

- 开发态固定到任务栏必然是 Electron 默认图标，不修。
- 固定项图标不跟随浅色/深色主题。
- 表单「保存并生效」做语义 round-trip，磁盘 YAML 注释不会保留；需要改注释请用外部编辑器。
- 工作副本独占：`requiresExclusiveWorkspace` 覆盖 svn-update/cleanup/revert/switch、git-pull/checkout/stash、unity-warmup、osg/revert-generated。SVN 更新/还原已按 `status -u` / 本地 status 的写集做文件句柄探测，步骤可用 `releaseOccupants: false` 关闭自动杀进程。后续再补：CommandLine 为空时的其它占用、远端写工具要不要也走独占。先不做。

## 明确不做

- 为开发态定制一份 electron.exe 只为了任务栏图标。
- 把脚本或架构说明塞进仓库根，或把 ADR 写成聊天记录。
- Agent 接入不以 OpenAI / Claude 官方 API 为主路径（见上：CodeBuddy SDK）。

# 退役实施单

依据 [ADR 0013](../adr/0013-retire-into-novoard-agent.md)。开工前先看 Novoard 仓 `docs/roadmap/roadmap.md`「跨仓：cronkit 吸收」表，确认依赖项已完成；做完一项回那张表改状态。

## C1 冻结

`now.md` 的「近期」中，仪表盘按任务分组、接入 Agent 两条停止推进。

## C2 导出脚本

新增 `scripts/export-novoard-targets.ts`：读取 config.yaml（v1 先迁移到 v2），输出 novoard-agent `targets.yaml` 片段。

用法：`npm run export-novoard -- [config.yaml] [--data-dir <dir>] [--out <file>]`。不给 config 时按托盘的默认位置查找；不给 `--out` 时打印到 stdout。存在 error 级问题时退出码为 1，找不到配置时为 64。所有问题会写进输出文件头注释，同时打印到 stderr。

映射规则：

| cronkit | novoard-agent |
| --- | --- |
| 每个 task × target | 一个 target，id 为 `<task.id>-<target.id>` |
| task.name / target.name | title：`<task.name> · <target.name>`；两者相同时只取一个 |
| trigger.cron / deadline | schedule / deadline；任务停用时不导出 schedule（warning） |
| target.oncePerDay | oncePerDay |
| target.path + step.path | 每个 uses step 的 cwd（按 cronkit 的规则解析） |
| usesTemplate + vars | 展开成内联 steps |
| builtin svn-* / git-* | `versionControl/<tool>` |
| builtin unity-warmup / quit-idle / release-occupants | `general/<tool>` |
| osg/<tool> | `osg/<tool>`，原样 |
| script | script，参数按 Windows 命令行规则加引号拼接 |
| uses step retry / retryInterval | retry / retryInterval；超过 10 截成 10（warning） |
| 含 remoteWrite 工具 | requiresApproval: true；删除 confirmRemoteWrite |
| 固定字段 | expose: local，audit: summary，notify: on-failure |

规则之外的处理：

- 释放占用：独占工具（requiresExclusiveWorkspace）前，若 `releaseOccupants` 不为 false 且上一步不是独占步骤，插入 `general/release-occupants`，路径为 target.path。对应 cronkit 编排器在独占步骤前自动释放占用的行为。
- timeout：agent 的 timeout 是整次运行的上限，按 Σ(步骤 timeout × 尝试次数) + 每步 1m 估算，释放占用步骤按 2m 计；非幂等工具只算 1 次尝试。
- strategy=manual：定时任务中 strategy=manual 的 svn-update / git-pull 在 cronkit 里只在手动触发时执行，导出时直接删除（warning）；需要的话在 agent 侧另建手动 target。
- quit-idle：cronkit 用步骤 timeout 作为等待上限，导出时补 `with.timeout`（packs 侧 quit-idle 新增了这个可选参数）。
- 参数：null、对象型参数丢弃（warning）；rawArgs 丢弃（warning）。
- script 的 retry：agent 的 script 步骤不支持 retry，丢弃（warning）。
- continueOnError：agent 任何一步失败就停止；非最后一步带 continueOnError 时给 warning，需人工决定是拆 target 还是接受行为变化。
- 外部 toolset 找不到 manifest：warning，按原样导出；builtin 工具没有对应包：error。没有可导出步骤的 target：error，不导出。
- 时区：文件头注明 cronkit 的时区，agent.json 中 `schedule.timezone` 需设为同一时区。

验收：

- 对 `config.demo.yaml` 导出的结果通过 novoard-agent schema 校验。
- 对 Windows 工作机上的真实 config.yaml 导出后人工核对。

### 实现偏差（2026-11-10）

- 映射表比原计划多了几项：release-occupants 归 general；title 在 task 与 target 同名时只取一个；script 步骤的 retry 丢弃。
- novoard-packs 的 quit-idle 新增可选参数 `timeout`，导出时由步骤 timeout 填入，否则迁移后等待上限会变成 24 小时。
- 验收：demo 导出 6 个 target、0 条问题，通过 agent 的 targets schema 与 uses 校验（novoard-packs 加 OSGToolset）。真实 config 的人工核对随 C3 在 Windows 工作机上做。

## C3 逐个迁移（Windows 工作机）

前提：novoard-agent PRD-7 全部完成，novoard-packs P1–P4 完成。

每个任务按以下步骤：

1. 把导出的 target 加到 agent。
2. 在 cronkit 中把该任务设为 `enabled: false`。
3. 打开 agent 定时开关。
4. 观察 3 晚，对照 cronkit 以往的运行日志。

回滚就是反向操作：agent 中删掉该 target 的 schedule，cronkit 中改回 `enabled: true`。

顺序：先迁 rider-idle-watch（风险最低），再逐个迁移 after-midnight 中的工程。

## C4 退役

- 退出并卸载托盘，取消开机自启。
- 停止 relkit 发版；relkit 服务器上的 cronkit 产品保留，不删除。
- GitHub 仓库归档，README 首行注明"已由 novoard-agent + novoard-packs 接替"。

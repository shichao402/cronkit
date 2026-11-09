# 退役实施单

依据 [ADR 0013](../adr/0013-retire-into-novoard-agent.md)。开工前先看 Novoard 仓 `docs/roadmap/roadmap.md`「跨仓：cronkit 吸收」表，确认依赖项已完成；做完一项回那张表改状态。

## C1 冻结

`now.md` 的「近期」中，仪表盘按任务分组、接入 Agent 两条停止推进。

## C2 导出脚本

新增 `scripts/export-novoard-targets.ts`：读取 config.yaml（v2），输出 novoard-agent `targets.yaml` 片段。

映射规则：

| cronkit | novoard-agent |
| --- | --- |
| 每个 task × target | 一个 target，id 为 `<task.id>-<target.id>` |
| task.name / target.name | title：`<task.name> · <target.name>` |
| trigger.cron / deadline | schedule / deadline |
| target.oncePerDay | oncePerDay |
| target.path | 每个 uses step 的 cwd |
| usesTemplate + vars | 展开成内联 steps |
| builtin svn-* / git-* | `versionControl/<tool>` |
| builtin unity-warmup / quit-idle | `general/<tool>` |
| osg/<tool> | `osg/<tool>`，原样 |
| script | script |
| step retry | retry |
| 含 remoteWrite 工具 | requiresApproval: true；删除 confirmRemoteWrite |
| 固定字段 | expose: local，audit: summary，notify: on-failure |

验收：

- 对 `config.demo.yaml` 导出的结果通过 novoard-agent schema 校验。
- 对 Windows 工作机上的真实 config.yaml 导出后人工核对。

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

# 0013. 能力并入 novoard-agent 后退役

- 状态：accepted
- 日期：2026-11-09
- 讨论来源：Novoard 仓 ADR-0012（cronkit 被 novoard-agent 吸收）

## 背景

cronkit 一个进程包办托盘界面、调度、执行和领域工具。novoard-agent 是本机唯一的联邦成员，两者并存会出现双执行内核、双调度器。讨论结论是调度归 agent 内核，领域工具拆成能力包，cronkit 本身不再保留。

## 决定

1. 即日冻结新功能，只修影响夜间任务的缺陷。
2. 去向：
   - 调度语义移植到 novoard-agent（其 PRD-7 A2）；
   - 领域工具迁到 novoard-packs（versionControl、general）；
   - 外部 toolset 机制由 agent 包管理接替，OSGToolset 原样接入。
3. 迁移采用"迁一个关一个"：同一任务任何时刻只在一边启用。
4. 全部迁出后退役，名字不保留。

## 后果

- 实施见 [retire-plan](../roadmap/retire-plan.md)。
- 退役前 cronkit 仍是 Windows 工作机夜间任务的执行者，不能先停。

# 0005. Task-first config v2 + React 配置编辑器

- 状态：accepted
- 日期：2026-08-21

## 背景

原配置页是 schedule↔workspace 多对多 + 原生 DOM `innerHTML` 重绘，只能「勉强能用」。用户需要以**自动化任务**为主对象的易用编辑器，并允许升级配置模型。

## 决定

1. **配置 v2**：顶层 `tasks[]`；每个 task 含 `trigger`（`cron`|`manual`）与内嵌 `targets[]`（path + steps）。步骤统一为 `uses: toolset/tool`。
2. **v1 兼容**：加载时内存迁移；显式保存才写 v2（保留 `.bak`）。同一 workspace 被多 schedule 引用时复制 target 并警告。
3. **编辑器**：引入 React；左侧任务列表 + 中间目标/步骤 + YAML 双视图；**保存并生效**（带 revision 冲突检测）；不做自动写盘、不做画布 DAG。
4. **运行语义不变**：一次 run = 一个 target；并发、路径锁、catch-up、oncePerDay 键格式保留（`targetId|taskId|tail`）。

## 备选

- 保留独立 workspaces 库 + task 引用：更贴近 v1，但编辑器容易退回「先维护库再绑定」，与 task-first 冲突。
- n8n 式无限画布：步骤是线性数组，画布成本高且误导。

## 后果

- CLI / Snapshot 仍暴露 `workspaceId` 作为 target 别名；新增 `runTarget` / `runTask` / `previewConfig`。
- 仪表盘本轮只做最小适配（显示 task 名），完整 task 列表 IA 可后续再做。

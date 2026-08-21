# Roadmap

只记还没做完、或明确不做的事。做成了就删条目，需要留「为什么」的搬到 ADR。

## 近期

- 用 `npm run dist` 验证打包后的任务栏固定图标与跳转列表名称（`WorkspaceOrchestrator` / 工作目录编排器），不以 `npm start` 的固定项为准。
- 保持 `document/` 三块同步：目录或分层一变，先改 architecture，决策则补 ADR。
- 仪表盘可进一步改成「按任务分组」列表（当前仍是 target 扁平行 + task 名芯片）。
- 准备接入 relkit（对接方式与范围待定）。
- 接入 Agent：优先覆盖「规划不清晰 / 分支多 / 异常多」的流程，先能交给 Agent 处理，再逐步沉淀规律并固化为确定性步骤；接入方式暂定 **CodeBuddy SDK**（不用 OpenAI / Claude 系列 API）。

## 已知缺口

- 开发态固定到任务栏必然是 Electron 默认图标，不修。
- 固定项图标不跟随浅色/深色主题。
- 表单「保存并生效」做语义 round-trip，磁盘 YAML 注释不会保留；需要改注释请用外部编辑器。

## 明确不做

- 为开发态定制一份 electron.exe 只为了任务栏图标。
- 把脚本或架构说明塞进仓库根，或把 ADR 写成聊天记录。
- Agent 接入不以 OpenAI / Claude 官方 API 为主路径（见上：CodeBuddy SDK）。

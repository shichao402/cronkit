# 0006. 全站 React 壳 + 表单唯一配置编辑

- 状态：accepted
- 日期：2026-08-21
- 相关：[0005](0005-task-first-config-react-editor.md)（config v2 与 task-first 仍有效；本条修正面板实现）

## 背景

0005 落地后，配置页是 React，仪表盘/设置仍是原生 DOM；配置页另起了一套 `.ce-*` 样式，并带表单|YAML 双视图与「已从 v1 预览迁移」提示。视觉与仪表盘脱节，顶栏信息过载。v1→v2 加载迁移已稳定，界面不必再强调迁移；需要改磁盘 YAML 时可用外部编辑器。

## 决定

1. **整站 React**：`src/renderer` 以 `App.tsx` 为壳（侧栏、导航、toast/banner）；仪表盘 / 设置 / 配置均为 React 视图；`index.html` 只挂 `#root`。
2. **统一设计语言**：复用现有 `styles.css` tokens 与控件类（`.page-head` / `.block` / `.rows` / `.btn` / `.seg` / `.chip` 等）；配置页不再维护平行视觉体系。
3. **配置编辑只保留表单**：去掉应用内 YAML/CodeMirror 双视图；冲突时引导外部编辑器或重载/覆盖；v1 加载迁移仍在 core，但不在 UI 展示迁移徽章。
4. **`tools/ui-preview`** 挂载同一套 React `App`（mock `window.api`）。

## 备选

- 继续混合原生 DOM + React 配置页：仪表盘好看、配置页另套样式，维护成本更高。
- 保留应用内 YAML：对高级用户方便，但与「表单为主」冲突，且顶栏/依赖更重。

## 后果

- 面板入口变为 `main.tsx`；旧 `renderer.ts` / 配置 `mount` / `YamlPanel` 删除。
- 磁盘 YAML 仍是配置真源；表单保存走 draft IPC，语义 round-trip，注释不保留（见 roadmap）。
- 仪表盘信息架构本轮仍是 target 扁平行（见 0005）；按任务分组仍是后续项。

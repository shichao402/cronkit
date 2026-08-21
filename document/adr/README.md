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

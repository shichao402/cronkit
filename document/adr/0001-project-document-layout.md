# 0001. 用 `document/{adr,architecture,roadmap}` 存项目文档

- 状态：accepted
- 日期：2026-08-21

## 背景

仓库根 README 只适合放启动/打包步骤。架构分层、拍板记录、后续规划混在一起会让根目录膨胀，也让「现在长什么样」和「当时为什么这么做」分不清。

## 决定

项目文档统一放 `document/`，固定三块：

- `document/adr/`：决策记录
- `document/architecture/`：当前结构
- `document/roadmap/`：规划与已知缺口

可执行脚本只放 `scripts/`。源码仍在 `src/`，图标源稿在 `design/`，运行时资源在 `resources/`，打包图标在 `build/`。

## 备选

- 根目录 `docs/`：常见，但本项目明确要用 `document/`，避免和「操作说明」或其它 docs 约定打架。
- 把 ADR 写进代码注释：搜不到、也没有状态流转。

## 后果

新的结构性决定先写 ADR 再大改。目录约定以 [architecture/directory.md](../architecture/directory.md) 为准。

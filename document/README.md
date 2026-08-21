# 项目文档

本仓库的说明文档只放在 `document/`，按三块组织：

| 目录 | 写什么 | 不写什么 |
| --- | --- | --- |
| [adr/](adr/) | 已经拍板、且以后改起来成本高的决定 | 实现细节、待办清单 |
| [architecture/](architecture/) | 系统现在怎么分层、数据怎么走、目录约定 | 某一次改动的理由（那是 ADR） |
| [roadmap/](roadmap/) | 近期要做、明确不做、以及已知缺口 | 已经落地的设计（那是 architecture） |

操作说明（怎么 `npm start`、怎么打包）仍写在仓库根 [README.md](../README.md)。脚本放 [scripts/](../scripts/)，不进 `document/`。

# 0012. 自动更新经单一 relkit-updater sidecar

- 状态：accepted
- 日期：2026-09-16
- 取代：[ADR 0010](0010-relkit-node-sdk-and-onboard.md) 中「进程内 `rup-client` 做 check/download」的客户端路径
- 保留：[ADR 0011](0011-versioned-dir-apply.md) 的稳定 launcher + versionedDir 布局

## 背景

relkit v0.3 把更新引擎收进独立的 `relkit-updater`：check、download、plan/session、
apply、回滚都在 sidecar 里，宿主只通过 `relkit.updater.v1` IPC 说话。TypeScript
bindings 只发布 protobuf-ES 类型，没有 Go / Dart / Rust 那种生成 facade。

cronkit 当时按 ADR 0010 自研了进程内 `rup-client`，再按 ADR 0011 用
`relkit-apply` + PowerShell 等待脚本做 versionedDir 切换。host.py 的产品树闸门把
这条路径标成 drift：`RupUpdater` 不是宿主调用面，源码必须 import lock 钉住的
`bindings-ts`。

硬约束：

1. 验签、选路、防回滚必须与 Go 引擎一致，不能再维护一份 Node 实现。
2. Windows 不能原地覆盖运行中的 exe；apply 仍必须等宿主退出。新引擎自己把
   sidecar 拷到安装树外、起 `--worker` 等退出，产品仓不再打包 `relkit-apply`。
3. IPC 窗口是编译期常量 `[1, 1]`，产品不得在 `ClientProfile` 里另写一套。
4. Electron 主进程可以 spawn sidecar；`src/core` 仍不得依赖 Electron（ADR 0002）。

## 决定

**打包并调用 lock 钉住的 `relkit-updater.exe`；本仓只写一层薄 IPC 客户端。**

- 协议类型从 `@relkit/updater-bindings`（`third_party/relkit/bindings/ts`）import。
- 帧格式与官方 facade 相同：4 字节大端长度 + protobuf；先 `-capabilities` 握手。
- `InstallSpec.layout = VERSIONED_DIR`，`sidecarRelpath = relkit-updater.exe`，
  `retain = 2`，`relaunch = true`。安装根推导仍用 ADR 0011 的规则。
- `apply(planId)` 返回 `requires_host_exit` 时，主进程只保存 UI 状态并退出。
- 发布树根目录放 `relkit-updater.exe`（与稳定 launcher、`active.json` 并列）；
  缺 sidecar 则打包失败。开发态（未打包）不检查更新。
- CI 先 `relkit_host.py install`，再 `stage`，再
  `RELKIT_RELEASE_VIA_CI=1 relkit_host.py release --execute`。

## 备选

- 继续进程内 `rup-client`：与官方引擎双轨，闸门永久 drift，拒绝。
- 在本仓再写一份完整 Node 更新引擎：重复夹具与 Windows 文件锁坑，拒绝。
- 等 relkit 官方 TS facade：当前没有；薄客户端工作量可控，不等。

## 后果

- ADR 0010 的 Node SDK 登记、`ensure-relkit.mjs` 稀疏检出、`relkit-apply` 的
  `b255ad0` 钉点、`scripts/apply-update.ps1` 全部作废。
- 稳定 launcher 与 `active.json` 仍由本仓构建；session 权威状态在 sidecar。
- relkit IPC、引擎二进制、bindings 必须作为同一 consume lock 升级。
- 旧安装里的 `relkit-apply.exe` 不会被新客户端调用；首次升到本 ADR 之后的版本
  靠现有 zip 解包路径，之后走 sidecar apply。

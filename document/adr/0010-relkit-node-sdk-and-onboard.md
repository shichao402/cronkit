# 0010. 接入 relkit 自动更新：自研 Node SDK + 按 RUP 标准开箱

- 状态：superseded by [0012](0012-relkit-updater-sidecar.md)（客户端改为 sidecar；发布侧 RUP 约定仍有效）
- 日期：2026-08-31
- 执行进展：[relkit 接入计划](../roadmap/relkit-onboard-plan.md)（阶段一至三已完成）

## 背景

cronkit 需要自动更新。上游 [relkit](https://github.com/shichao402/relkit) 实现了 RUP（Release & Update Protocol）v2，
发布侧与客户端侧的契约写在 relkit 仓库的 `SPEC.md`，结构 SSOT 在 `proto/rup/v2/`。

硬约束有五条：

1. **relkit 官方只登记了 Go 与 Dart 两种客户端 SDK**（见 `docs/agent/sdk-cascade.md` 的登记表）。
   cronkit 是 Electron 37 + electron-vite + React 19 + TypeScript（ESM，Node ≥ 20），两者都不匹配，
   不存在「装个包就接上」的路径。
2. `SPEC.md` §1.1 第 3 条把「版本比较、选路、验签三处在 Go / Dart / **Node** / C# 中结果完全一致」
   列为设计目标，并用 `conformance/` 四组夹具强制约束。也就是说 Node 方向是协议预留过的，只是尚无实现。
3. `SPEC.md` §8 明确禁止解析 `version` 字符串比较大小，只允许比较整数 `code`；
   `docs/agent/README.md` §4 第 3 条要求版本号只认 `VERSION.json` + `relkit version …`，禁止再发明第二套解析器。
   cronkit 现在的版本号在 `package.json` 里（`0.1.0`），与这条冲突，必须消解。
4. `cmd/relkit-apply` 这个独立 sidecar **只实现 versionedDir**，传 wholeRoot 会直接报错。
   cronkit 的 `electron-builder.yml` 打的是 `target: dir`，属于目录型便携应用，
   而 `sdk/dart/lib/src/apply/layout.dart` 给出的默认布局在 Windows 上正是 versionedDir，方向一致。
5. `docs/agent/README.md` §4 第 6 条：宿主若已有另一套自动更新，必须停下来问用户。
   cronkit 当前没有任何自动更新机制（`package.json` 无 `electron-updater` 等依赖），因此不存在双轨风险。

## 决定

**在 relkit 仓库内自研官方 Node/TypeScript SDK（`sdk/node`，包名 `rup-client`），并按 RUP 标准为 cronkit 做完整工具链开箱。**

具体分成三件事：

1. **relkit 侧**：新增 `sdk/node`，跑通 `conformance/` 全部夹具，并按 `sdk-cascade.md` 的规定
   同时完成三项登记动作（级联表加一行、SDK 根目录放 `AGENT-QUICKSTART.md`、`bootstrap.sh` / `bootstrap.ps1` 加 Node 探测分支）。
   **本次改动一律不提交，交由 relkit 侧自行核对后再提交。**
2. **cronkit 发布侧**：按 `docs/agent/toolchain-onboard.md` 走路径 A，产出 `VERSION.json` + `relkit.json`，
   密钥用 `relkit keygen` 生成、私钥不入库。
3. **cronkit 客户端侧**：主进程接入 `rup-client` 做 check / download，apply 采用 versionedDir，
   并与托盘常驻 + `idle-quit` 的退出时机协调。

`VERSION.json` 是版本号的唯一来源。`package.json` 的 `version` 字段降级为构建期同步产物，
禁止再手工编辑；`code` 取 `VERSION.json` 中 `+` 后的整数（relkit 默认 `codeStrategy: version-build`）。

## 备选

**Go sidecar（把 `relkit` CLI 加一个客户端 check/download 命令，Node 侧 spawn 它）**：
最省事，验签与选路全部复用已被夹具覆盖的 Go 实现，但要往安装包里塞一个约 10 MB 的 exe，
且 relkit CLI 现有子命令（init / keygen / version / stage / inspect / simulate / verify / publish / fallback / directory / agent-guide / backends）
并没有 check / download，仍需新增命令。选 B 是为了产出一个可复用、可登记的官方 Node SDK，长期更干净。

**只用 `relkit-apply`，check 自己糊**：等于把验签和选路这两处最易错的逻辑自己写一遍却不受夹具约束，
正是 `SPEC.md` §3 点名要避免的分歧来源。否。

**改用 electron-updater / Squirrel**：与 relkit 双轨，违反 `docs/agent/README.md` §4 第 6 条，且丢掉多跳升级链与签名根。否。

## 后果

之后必须遵守：

- Node SDK 的验签**必须**对 `Envelope.payload` 的原始字节做 Ed25519 校验，禁止对反序列化后重新编码的对象验签
  （`conformance/signature/envelope.json` 的 `cross-payload-replay` 用例专抓这个）。
- 遇到未知 keyId 的签名**禁止**就此放弃，必须继续遍历后续签名（`rotation-untrusted-first` 用例）。
  空签名数组、未知 alg 一律拒绝，禁止理解为「没什么要检查的」。
- `selectNextTarget` 必须按 `code` 取最大值，禁止取数组末项（`version-select/unordered.json`）。
- 多 artifact 命中时取 `id` 字典序最小者，禁止「取第一个」。
- 公钥**只能**编译期内嵌，禁止运行时下载。至少内嵌两把（当前 + 备用）以便轮换。
- `entryUrls` 一旦随安装包发出就几乎不可变，首版必须直接用 `https://raw.firoyang.com/rup/directory/<product>.pb`，
  禁止为赶时间先用 COS 默认桶域名。
- `clientSelectors` 的取值必须与 `relkit stage --add … os=…,arch=…` 逐字一致。
  注意 relkit 文档自身存在不一致：`README.md` 示例写 `arch=x64`，`sdk/AGENT-QUICKSTART.md` 写 `arch: "amd64"`。
  cronkit 统一采用 **`os=windows,arch=x64`**（对齐 `SPEC.md` §11.1 的标准取值表）。
- 开发态（未打包）的 `currentCode` 必须取一个高于所有已发布版本的值（如 `2147483647`），
  **禁止**当作 `0`（`SPEC.md` §8.1），否则一次误判就会把开发环境降级成正式版。
- apply 只能在「无任务运行 + 用户确认」时执行；改为 versionedDir 布局会影响
  `app.setLoginItemSettings({ path: process.execPath })` 与 `app.requestSingleInstanceLock()` 的路径假设，必须同步复核。
- 用户数据目录 `%APPDATA%/cronkit` 在安装根之外，天然不受目录替换影响；禁止把运行时数据移进安装目录。
- **conformance 夹具通过不等于可以上线。** 夹具是 v1 JSON schema，验证的是语义对齐；
  必须另做一次「用 `relkit publish` 真实产出的 v2 protobuf 跑 check + download」的格式对齐冒烟。
  首次接入正是靠这一步抓到两个夹具覆盖不到的缺陷（`trustedKeys` 类型过窄导致崩溃、
  Windows 上以追加模式句柄 `truncate` 抛 `EPERM` 导致所有下载失败）。
- Windows 上**禁止**通过追加模式（`"a"` / `"a+"`）打开的文件句柄调 `truncate`：
  该句柄只有 `FILE_APPEND_DATA` 权限，必然 `EPERM`。需要预分配大小时用 `"r+"` 另开一次。

接受的代价：

- 要重写选路、selector 匹配、sequence 防回滚、源学习排序、Range 续传，工作量数倍于 sidecar 方案。
- relkit 仓库多一个语言 SDK 需要长期与 Go / Dart 保持行为对齐，每次协议改动要同步三处。
- 打包形态从「一层 dir」变成「versionedDir + 稳定 launcher」，首次改造有回归风险。

versionedDir 的宿主实现与构建约束由 [ADR 0011](0011-versioned-dir-apply.md) 记录。

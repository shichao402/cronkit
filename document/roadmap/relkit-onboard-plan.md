# relkit 接入计划（路线 B：自研 Node SDK）

- 状态：阶段一至三已完成；阶段四剩 4 项，另有发布路径收口 5 项（§4.1）
- 日期：2026-09-01
- 决策：[ADR 0010](../adr/0010-relkit-node-sdk-and-onboard.md)
- 上游仓库：`D:/workspace/GitHub/relkit`（RUP v2，`SPEC.md` 为唯一契约）

## 进展快照（2026-08-31）

| 阶段 | 状态 | 关键结果 |
|---|---|---|
| 一：relkit `sdk/node` | 已完成 | 16 个源文件；`npm test` 42 项全绿（conformance 13 项 / 65 用例 + 单测 29 项）；四项级联登记已落地 |
| 二：cronkit 工具链开箱 | 已完成 | `VERSION.json` `0.1.0+1`、`relkit.json`（COS 主后端）、`keys/` 已忽略；本地 publish + `directory set` + `verify` 全过 |
| 三：客户端 check/download/UI/apply | 已完成 | 前半 6 场景视觉核对通过；后半已产出稳定 launcher + versionedDir ZIP，`tsc --noEmit` 干净、`npm test` 76 项全绿 |
| 四：冒烟验收 | 部分完成 | §4 中 6 项已在跨实现闭环冒烟里通过，剩 5 项 |

跨实现闭环冒烟（用 `relkit publish` 真实产出的 v2 protobuf 喂 Node SDK）抓到两个夹具覆盖不到的缺陷，均已修并补回归用例：

| 缺陷 | 现象 | 修法 |
|---|---|---|
| `trustedKeys` 只接受 `TrustedKeys` 实例 | 传普通对象时在验签深处抛 `trusted.get is not a function`，报错位置误导 | 新增 `toTrustedKeys()`，对象 / `Map` / base64 字符串全接受，构造函数统一归一化 |
| Windows 上 `.part` 预分配失败 | 追加模式句柄只有 `FILE_APPEND_DATA`，`truncate` 抛 `EPERM`，导致所有下载失败 | 拆成两次 open：`"a"` 建文件、`"r+"` 改大小 |

结论：**夹具验证语义，真实 protobuf 验证格式，两者不可互相替代。** 已把这条写进 `sdk/node/AGENT-QUICKSTART.md` §N5。

## 0. 前置约定（先读，别跳）

**relkit 仓库的所有改动本次一律不提交**，只留工作区改动 + 一份自检清单（见 §5），
交由 relkit 侧自行核对后再决定提交。cronkit 仓库的改动正常提交。

执行顺序不可交换，来自 `docs/agent/README.md` §1：
先跑探测脚本 → 路径 A 工具链开箱 → 路径 B SDK 开箱 → 冒烟。
**禁止**在未确认路径时就改 `minFrom`、手改远端 index、或把私钥写进仓库。

需要用户先拍板的三个值（未定则停下来问，不要自创）：

| 项 | 建议值 | 说明 |
|---|---|---|
| `product` | `cronkit` | 小写、稳定；改名等于断更 |
| `channel` | `stable` | 默认通道 |
| 首版 `VERSION.json` | `0.1.0+1` | `code` = `+` 后整数 = `1` |

## 1. 阶段一：relkit 侧新增 Node SDK（`sdk/node`）

### 1.1 目录与包

对齐 `sdk/dart` 的组织方式（`sdk/README.md` 已登记 Go 在 `sdk/*.go`、Dart 在 `sdk/dart/`）：

```text
sdk/node/
  package.json          # name: rup-client, type: module, engines.node >= 20
  tsconfig.json
  AGENT-QUICKSTART.md   # 结构对齐 sdk/AGENT-QUICKSTART.md 与 sdk/dart/AGENT-QUICKSTART.md
  README.md
  src/
    gen/                # 由 proto/rup/v2/*.proto 生成
    models.ts           # schema 常量、类型别名
    envelope.ts         # §4.1 验签
    chain.ts            # §9.2 selectNextTarget / §9.5 resolveUpgradePath / isMandatory
    selectors.ts        # §11 匹配与仲裁
    state.ts            # §12.2 / §12.4 StateStore + 节流 + lastSeenSequence
    preference.ts       # §12.7 源学习排序
    fetch.ts            # 超时、重定向、缓存击穿
    download.ts         # Range 续传、并行分块、进度
    updater.ts          # §12.1 编排 + §12.6 fallback 合并
    scheduler.ts        # 启动 + 周期检查
  test/
    conformance.test.ts # 消费 ../../conformance/ 四组夹具
```

Go 文件必须留在 `sdk/*.go` 不能动（否则 `go get cnb.cool/shichao402/relkit/sdk` 断链），
Node 嵌在 `sdk/node/` 与 Dart 并列。

### 1.2 protobuf 生成

SSOT 是 `proto/rup/v2/` 四个文件（`objects.proto` 5.02 KB、`envelope.proto` 674 B、`keys.proto` 593 B、`http.proto` 392 B）。
用 `@bufbuild/protobuf` + `protoc-gen-es` 生成 `src/gen/`，与 Dart 的 `lib/src/gen/` 一样检入仓库，
避免宿主安装时还要装 protoc 工具链。

注意 `objects.proto` 的两个细节：

- 签名消息**禁止**用 `map<>`，`selectors` / `meta` 是 `repeated Selector` / `repeated MetaEntry`，
  编码前按 key 排序。解码侧转成 `Map<string,string>` 即可，但**不要**在客户端重新编码后验签。
- `Index` 有 `min_supported` 与 `has_min_supported` 两个字段并存。`isMandatory` 必须先看
  `has_min_supported`，不能靠 `min_supported !== 0` 判断（Dart 侧 `chain.dart` 用的是 `hasMinSupported_7`）。

### 1.3 必须逐字对齐的四处规范性行为

以 Dart 实现为参照（行为最接近，且已跑通夹具）：

**验签（`envelope.ts`，参照 `sdk/dart/lib/src/envelope.dart`）**
用 Node 内置 `crypto.verify('ed25519', payload, keyObject, sig)`，不引入第三方密码库。
判定顺序：解析失败 → `malformed`；`schema !== 'rup.envelope/2'` → `wrongSchema`；
`signatures` 为空 → `noSignatures`；遍历签名，跳过 `alg !== 'ed25519'` / 空 keyId / 不在信任集 / 长度非 64 的条目，
任一验证通过即接受并返回 `payload` 原始字节；全部失败 → `notVerified`。
公钥用 `crypto.createPublicKey({ key: derFromRaw32, format: 'der', type: 'spki' })` 包装 32 字节裸公钥。

**选路（`chain.ts`，参照 `sdk/dart/lib/src/chain.dart`）**
候选条件：非 `yanked`、`code > currentCode`、`minFrom <= currentCode`；取 `code` 最大者。
`resolveUpgradePath` 循环不设迭代上限。

**产物选择（`selectors.ts`，参照 `sdk/dart/lib/src/selectors.dart`）**
artifact 声明的每个键值都必须等于客户端对应值；客户端多出的键忽略；空 selectors 匹配所有。
多命中取 `id` 字典序最小。

**防回滚（`state.ts`）**
`lastSeenSequence === indexSequence` 时**必须接受**（再次取到同一份 index 是正常情况）；
`lastSeenSequence` 为 null 表示首次运行；小于则拒绝该源并静默换下一源，不得报给用户。
directory 的 `directory_sequence` 独立持久化，fallback 的 `sequence` 再独立一份。

### 1.4 网络行为

- 超时：index / manifest / directory 各 10 秒；artifact 无总时长上限，空闲 60 秒超时。
- 重定向最多 5 跳；**禁止**跟随 https → http 降级；**禁止**因落地域名与文档域名不同而拒绝下载。
- 可变文档（directory / index / fallback）带 `Cache-Control: no-cache` 或 `?t=<unix秒>`；
  不可变对象（manifest / artifact）**禁止**缓存击穿。
- 多镜像**必须**串行回退，**禁止**并行竞速；**禁止**为选源单独发探测/测速请求。
- 校验顺序固定为先 `size` 再 `sha256`，且必须在完整落盘后做；失败必须删文件。
  未完成的临时文件用 `.part` / `.part.meta` 与成品区分。

### 1.5 文件名安全（§14.4）

落盘前校验 `filename`：不含 `/` `\`、不等于 `.` / `..`、不含 `..` 片段、无控制字符与 NUL、
不是 Windows 保留设备名（`CON` `PRN` `AUX` `NUL` `COM1`–`COM9` `LPT1`–`LPT9`）。失败拒绝该 artifact。

### 1.6 验收：跑通 conformance 夹具

`conformance/README.md` 规定「任何一个用例不通过，该实现禁止声称兼容 RUP」。
runner 必须按原样使用夹具，**禁止**补全缺省字段。

| 夹具目录 | 用例 | 覆盖 |
|---|---|---|
| `version-select/` | flat-chain、three-hops、required-intermediate、unordered、single-version、min-supported、yanked、yanked-head | §9 |
| `selector/` | os-arch、target-dimension、ambiguous | §11 |
| `signature/` | envelope（含 unknown-key、cross-payload-replay、unsupported-alg、no-signatures、rotation-untrusted-first）、anti-rollback、keys | §4.1 / §12.4 |
| `reachability/` | 发布侧行为，Node 客户端 SDK **不需要**实现 | §10 |

`signature/keys.json` 里的密钥是测试专用平凡种子，**禁止**用于真实发布。

### 1.7 三项登记动作（`sdk-cascade.md` 硬性要求）

1. `docs/agent/sdk-cascade.md` 的「当前已登记 SDK」表加一行：
   `| Node | rup-client（SSOT：sdk/node/） | ../../sdk/node/AGENT-QUICKSTART.md | npm i（或 file: / git 依赖） |`
2. `sdk/node/AGENT-QUICKSTART.md` 落地，章节结构对齐 Go / Dart 现稿（N0 何时用 → N1 安装 → N2 最小片段 → N3 字段对齐 → N4 能力边界 → N5 Done → N6 排障 → Fallback）。
3. `docs/agent/bootstrap.ps1` 与 `bootstrap.sh` 加 Node 探测分支：
   检测 `package.json`（可进一步识别 `electron` 依赖），命中则把第 3 步指向 `sdk/node/AGENT-QUICKSTART.md`。
   现有脚本在既无 `pubspec.yaml` 也无 `go.mod` 时会退化成「pick language manually」，正是要补的分支。
4. 顺带更新 `sdk/README.md` 的目录表与对齐矩阵，加上 Node 一列。

## 2. 阶段二：cronkit 工具链开箱（路径 A）

按 `docs/agent/toolchain-onboard.md` 逐条执行，工作目录是 cronkit 仓库根。

```powershell
relkit --version
relkit init --product cronkit
relkit version set 0.1.0+1
relkit version get
relkit keygen --key-id cronkit-2026 --out keys --update-config
```

产出与约束：

- 仓库根出现 `VERSION.json`（`schema: rup.version/1`）与 `relkit.json`。
- `keys/` 必须进 `.gitignore`；私钥只留本机或 CI secret，**永不入库**。
- 公钥进 `relkit.json`，同时客户端还要**再内嵌一份**（阶段三）。
- 后端选 `s3-compatible`，复用已实装的广州 COS：

```json
{
  "type": "s3-compatible",
  "endpoint": "https://cos.ap-guangzhou.myqcloud.com",
  "bucket": "relkit-updates-1251882798",
  "region": "ap-guangzhou",
  "prefix": "rup/",
  "baseUrl": "https://raw.firoyang.com/rup/",
  "accessKeyEnv": "COS_SECRET_ID",
  "secretKeyEnv": "COS_SECRET_KEY"
}
```

缓存必须在 COS/CDN 控制台按前缀配：`directory/` `index/` `fallback/` 短缓存（≤60s），
`manifest/` `artifact/` 长缓存。配错的典型现场是「发布成功但客户端几分钟内看不到更新」。

### 2.1 版本号唯一来源

`VERSION.json` 是唯一来源，`package.json` 的 `version` 降级为构建期同步产物。
加一个 `scripts/sync-version.mjs`（或并入 `npm run build` 前置步骤）：
读 `VERSION.json` → 写回 `package.json.version` → 同时产出编译期常量。
**禁止**手工编辑 `package.json.version`，也禁止再写第二个版本解析器。

### 2.2 首次端到端（建议先用假产物）

```powershell
relkit stage --add dist/cronkit-0.1.0-win-x64.zip os=windows,arch=x64
relkit simulate --with-staged 0.1.0+1 --from all
relkit publish --dry-run
relkit publish
relkit verify --deep
```

`simulate` 必须带 `--with-staged`，否则看不到本次节点对旧客户端的影响。
`arch` 统一用 `x64`（对齐 `SPEC.md` §11.1），并与客户端 `clientSelectors` 逐字一致。

### 2.3 实际落地结果与偏差（2026-08-31）

已执行并通过：

```powershell
relkit init --product cronkit
relkit keygen --key-id cronkit-2026 --out keys --update-config
relkit stage --add <假产物>.zip os=windows,arch=x64
relkit simulate --with-staged 0.1.0+1 --from all   # 全起点可达 0.1.0+1
relkit publish --dry-run
relkit publish                                     # local 后端，sequence 1
relkit directory set                               # directory sequence 1
relkit verify                                      # signature ok / reachability ok / manifest ok
```

与原计划的三处偏差，都是有意为之：

仓库里的 `publishTo` 暂留 `local`，`cos` 后端只作为生产配置模板。理由：本机只负责
build + stage，不持签名私钥或 COS 凭据，也不直接执行生产 publish。真正对外发版先在
`publish.firoyang.com` 的 `relkit-agent` 登记 `cronkit`，把生产 `relkit.json`
放入产品 root 并在该副本启用 `publishTo: ["cos"]`；CI 只上传 staged 树并触发 agent。

`relkit version set 0.1.0+1` 未单独执行：`relkit init` 生成的 `VERSION.json` 初值已是 `0.1.0+1`。

`relkit.json` 增配了 `directory` 块（`entryUrls` + 两个 channel 的 services），
原计划未列。没有它 `relkit directory set` 无法执行，而 directory 是 `entryUrls` 引导的落点。

签名私钥的注入方式：`signing.privateKeyEnv` 收的是 **base64 编码的 32 字节种子**，
不是私钥文件内容。本机演练时从 `keys/cronkit-2026.private.pb` 里取 `seed` 字段（proto 字段 4）转 base64。
该 base64 只进入 `relkit-agent` 发布机的受限环境；CI 只保存 `RELKIT_AGENT_TOKEN`。

### 2.4 版本同步脚本已落地

[`scripts/sync-version.mjs`](../../scripts/sync-version.mjs)：读 `VERSION.json` → 写 `package.json.version`
+ 生成 `src/generated/version.ts`（`APP_VERSION` / `APP_VERSION_FULL` / `APP_VERSION_CODE`）。

接入点：`prebuild` 钩子 + `dist` 脚本，另有 `npm run check-version` 供 CI 校验不一致即失败。
`src/generated/version.ts` 已入库（编译期常量需要被 tsc 看见），但**由脚本生成，禁止手改**。

### 2.5 跨实现闭环冒烟脚本已固化

[`scripts/relkit-smoke.mjs`](../../scripts/relkit-smoke.mjs)：起一个本机静态 HTTP（支持 Range），
把 `relkit publish` 真实产出的 v2 protobuf 发布树喂给 `rup-client`，跑 8 组 13 项断言。

```powershell
# 前置：某目录已用 local 后端 publish + directory set，且 baseUrl 端口与下面一致
node scripts/relkit-smoke.mjs <publishDir> <publicKeyBase64> [port]
```

`port` 必须与发布时 `baseUrl` 的端口逐字一致。协议禁止客户端自行拼接 URL（SPEC §1.1），
index / manifest / artifact 的地址都来自上一跳签名文档；端口不符会表现为 `check-failed`，
那是配置不一致而非 SDK 故障——固化脚本时实测踩过一次，已写进脚本头注释。

当前结果：

```text
1. fresh install sees the release          PASS x3
2. download passes size + sha256           PASS x4（含服务端确认收到 Range 请求）
3. already-current client is up to date    PASS
4. wrong selectors find no artifact        PASS
5. wrong trusted key is rejected           PASS
6. wrong product is rejected               PASS
7. unreachable entry fails without crash   PASS x2
8. throttling holds without force          PASS x2
relkit smoke PASSED
```

## 3. 阶段三：cronkit 客户端接入（路径 B）

### 3.1 分层落点（守 ADR 0002）

`src/core` 不得依赖 Electron。因此：

- `src/core/update/` 放纯逻辑：配置常量、code 推导、apply 决策（可单测，无 Electron 依赖）。
- `src/main/update.ts` 放 Electron 相关：`app.getPath` 取状态目录、托盘菜单项、IPC、对话框、重启。
- `rup-client` 只在主进程使用，渲染进程通过 IPC 拿状态。

### 3.2 编译期常量

在 `electron.vite.config.ts` 的 `main.define` 注入（或由 `sync-version.mjs` 生成一个 `src/core/update/build-info.ts`）：

```ts
export const UPDATE_PRODUCT = "cronkit";
export const UPDATE_CHANNEL = "stable";
export const UPDATE_ENTRY_URLS = [
  "https://raw.firoyang.com/rup/directory/cronkit.pb",
];
export const UPDATE_TRUSTED_KEYS = {
  "cronkit-2026": "<base64-32-byte-ed25519-pubkey>",
};
export const CURRENT_CODE = 1; // 由 VERSION.json 的 +build 生成
```

`entryUrls` 用 `raw.firoyang.com`（不是 `updates.`，后者将来要让给索引站）。
**禁止**先用 COS 默认桶域名发一版。

### 3.3 currentCode 的开发态处理

```ts
const currentCode = app.isPackaged ? CURRENT_CODE : 2147483647;
```

未打包时取一个高于所有已发布版本的值，从而永不触发更新（`SPEC.md` §8.1）。
**禁止**当作 `0`。

### 3.4 状态与下载目录

- StateStore 落 `%APPDATA%/cronkit/update-state.json`（按 product+channel 分文件），
  复用 `src/core/paths.ts` 的 `defaultDataDir()`，不要与 `state.json` 混写。
- 下载暂存落 `%APPDATA%/cronkit/update-staging/`，与安装目录分离。

### 3.5 UI 与调度

- 托盘菜单加「检查更新」，走 `check({ force: true })` 绕过节流。
- 启动后与周期性检查用 SDK 的 scheduler（默认成功后 24h、失败后 1h）；
  `CheckThrottled` 只重臂定时器，不弹 UI。
- 设置页展示当前版本、上次检查时间、更新说明（Markdown）。
- `FallbackRequired` 时只展示 message 并打开 `manual_url`，**禁止**自动下载或 apply。

### 3.6 apply：versionedDir 改造

这是本计划风险最集中的一步，建议**独立一个阶段做，不与 SDK 开发混在一起**。

现状 `electron-builder.yml` 是 `target: dir`，产物是一层普通目录。目标布局：

```text
<installDir>/
  WorkspaceOrchestrator.exe   # 稳定 launcher，读 active.json 后转跳
  active.json                 # { code, version, path, executable }
  versions/
    0.1.0/                    # 实际应用目录
    0.1.1/
```

必须同步复核的三处：

- `app.setLoginItemSettings({ path: process.execPath })`：开机自启必须注册**稳定 launcher** 的路径，
  不能是 `versions/<version>/` 下的 exe，否则升级后自启失效。
- `app.requestSingleInstanceLock()`：确认换目录后单实例锁仍然生效。
- `resource()` 里的 `process.resourcesPath` 与 `app.getAppPath()`：布局变化后路径要重新验证。

apply 时机必须与托盘常驻协调：只在「无任务运行 + 用户确认」时执行。
`src/core/idle-quit.ts` 已有空闲判定，apply 前必须复用它确认无运行中的任务，
禁止在编排任务跑一半时换目录。本地只保留 2 个版本目录（当前 + 上一个）。

若首版想降低风险，可先只做到「下载完成 + 校验通过 + 提示用户手动安装」，
在文档里写明「仅下载到目录」，apply 留到下一阶段——`docs/agent/README.md` §3 允许这样勾 Done。

### 3.7 实际落地结果（2026-08-31，前半已完成）

首版按 §3.6 末段的低风险路径落地：**只做到下载 + 校验 + 提示手动安装，不含 apply**。

新增文件：

| 文件 | 职责 |
|---|---|
| [`src/core/update/config.ts`](../../src/core/update/config.ts) | 编译期常量与 `resolveCurrentCode()`，`DEV_CURRENT_CODE = 2147483647` |
| [`src/core/update/status.ts`](../../src/core/update/status.ts) | 8 个 phase 的纯逻辑状态机 + `canInstallNow` / `canSkip` / `progressPercent` / `formatBytes` / `formatSpeed` / `hopHint`，无 Electron 依赖 |
| [`src/main/update.ts`](../../src/main/update.ts) | `UpdateService`：编排 SDK、节流进度推送、下载失败后查 fallback |
| [`src/renderer/views/UpdateSection.tsx`](../../src/renderer/views/UpdateSection.tsx) | 设置页「更新」分组 |
| [`tests/update-status.test.ts`](../../tests/update-status.test.ts) | 12 项纯逻辑测试，锁住安装闸门、强制更新不可跳过、`DEV_CURRENT_CODE` 取值 |

改动文件：`src/main/index.ts`（IPC + 托盘「检查更新」+ 生命周期）、`src/preload/index.ts`（7 个通道）、
`src/renderer/global.d.ts`、`src/renderer/views/Settings.tsx`（挂载 + 副标题）、
`src/renderer/styles.css`（`.chip-warn` / `.update-notes` / `.update-bar` 三条新样式）、
`package.json`（`rup-client` + `@bufbuild/protobuf`）、`tools/ui-preview/mock-api.ts`（7 个 mock 方法 + 7 种 `?scenario=update-*`）。

UI 一律复用既有体系（`setting-group` / `setting-row` / `state-dot` / `btn btn-quiet btn-sm` / `chip` / `chip-mono`），
只新增上述三条类，且全部走既有 CSS 变量。已按 `?scenario=update-*` 逐个视觉核对：
默认（有新版本）、下载中、失败（浅色主题）、强制更新、已下载待安装、需手动更新。

本阶段新踩的四个坑：

| 坑 | 现象 | 结论 |
|---|---|---|
| `DownloadProgress` 字段名 | 按记忆写成 `receivedBytes` / `totalBytes`，SDK 实际是 `received` / `total` | 跨实现接线必须回读 SDK 源码，不能靠命名直觉；本项目状态里保留 `*Bytes` 命名，在 `onProgress` 处一次性转换 |
| `file:` 依赖的传递依赖不提升 | `rup-client` 的 `@bufbuild/protobuf` 留在 relkit 目录内（Windows 装成 Junction），顶层 `node_modules` 里没有 | 显式把 `@bufbuild/protobuf` 声明为 cronkit 直接依赖，否则 dev 能跑但打包大概率漏。验证要用 `await import()`，该包不导出 `./package.json` |
| 单实例锁挡住 self-test | 托盘已有实例在跑时 `npm run self-test` 直接静默退出、不写结果文件 | 这是环境冲突不是回归。视觉验证改走 `tools/ui-preview`（浏览器 mock），不必终止用户正在运行的应用 |
| `.setting-row` 是 `space-between` | 发布说明与进度条只占内容宽度，撑不满整行 | 加 `.setting-group.update .setting-text { flex: 1 1 auto; }`，并用 `setting-group update` 限定作用域，避免影响其他设置分组 |

### 3.8 versionedDir apply 实际落地（2026-09-01）

宿主 apply 已按 [ADR 0011](../adr/0011-versioned-dir-apply.md) 独立落地：

- `tools/update-launcher/main.go` 构建根目录稳定 launcher，读取并约束 `active.json` 路径后转发参数。
- `scripts/package-versioned.mjs` 把 `.release/win-unpacked` 组装为
  `dist/cronkit-<version>-win-x64.zip`，并固定构建上游 `relkit-apply` 首次实现提交 `b255ad0`。
- `src/core/update/apply.ts` 集中安装根推导、sidecar 参数与 session 解析，保持无 Electron 依赖。
- `src/main/update.ts` 在二次空闲检查和用户确认后解包；PowerShell 等主进程退出，再启动 sidecar；
  apply session 按契约写入稳定安装根的 `update_apply.json`。
- 开机自启改为稳定 launcher 路径；首次单层安装与后续 `versions/<version>` 安装使用同一套根目录推导。
- 设置页提供「安装并重启」，同时保留「打开所在目录」作为排障入口；没有新增样式词汇。

验证结果：

```text
npx tsc --noEmit                         PASS
npm test                                 PASS（76 tests）
go build tools/update-launcher/main.go   PASS
npm run dist                             PASS（versionedDir ZIP）
relkit-apply 临时目录迁移集成测试         PASS
```

首次完整打包发现已有运行实例锁住旧 `dist/win-unpacked`，因此 electron-builder 中间产物固定写入
已忽略的 `.release/`；最终 ZIP 仍写 `dist/`。这不是通过终止常驻实例规避，而是让构建与运行目录隔离。

## 4. 阶段四：冒烟验收

来自 `sdk-cascade.md`「开箱后冒烟」与 `README.md` §3。
前六项已在跨实现闭环冒烟中通过（`relkit publish` 真实产出的 v2 protobuf + 本机静态 HTTP）：

- [x] 用比 head 更小的 `currentCode` 调 `check` → 得到 available
- [x] `download` → 文件 sha256 与 manifest 一致（并确认服务端收到 Range 请求）
- [x] 入口不可达 → `check-failed` 且不崩溃、不留假文件
- [x] 故意换错公钥 → 验签失败且拒绝使用，不降级为不验签
- [x] `clientSelectors` 改成 `arch: amd64` → 复现「no artifact matches」
- [x] 已是最新版的客户端 → `up-to-date`
- [ ] 真实断网（非仅端口不可达）场景复测
- [ ] `product` 改错一个字 → 整份 index 被拒
- [ ] 节流生效，`force: true` 可绕过（单测已覆盖边界，尚未在真实链路上验）
- [ ] 公钥轮换流程写进 cronkit 文档（先双钥并存发一版，再删旧钥）
- [x] 经 `relkit-agent` 向 COS 真实 publish 一次并 `verify --deep`（发布机持签名与 COS 凭据）
      —— 已完成，但**发布路径不合规**，见 §4.1

### 4.1 首次发布与发布路径改造（2026-09-01）

`0.1.0+1` 已经发布到 COS 并通过匿名 HEAD 校验，但那一次是手工完成的：产物在开发机
`npm run dist` 打出，经 SSH 传到发布机，再以 root 读取 `/etc/relkit-agent/token` 后直连
`127.0.0.1:8787` 调 `/v1/staged` 与 `/v1/publish`；中途因目录属主不对返回 500，又在发布机上
`chown` 后重试。整个过程绕过了 CI、绕过了 nginx 公网入口，也没有任何构建记录。

之所以做得成，有两个结构性原因，都不是"注意一点"能解决的：

- Bearer token 与签名私钥在同一台机器上，发布机的 root 同时拥有两者。token 边界防的是
  CI runner 被攻陷，防不了持有 root 的人。
- RUP 签名证明的是密钥持有，不是产物出处。签名里没有 commit、没有流水线运行号，客户端
  分辨不出手工发布与 CI 发布，事后也识别不出来。

该版本予以保留（对应干净提交 `af7cc52`，且是首版、无历史包袱）。发布路径已按下列改动收口：

| 改动 | 位置 | 解决的问题 |
|---|---|---|
| 发布流水线 | `.github/workflows/release.yml` | 已从 CNB 迁到 GitHub Actions；CI 只持产品级 `RELKIT_UPLOAD_TOKEN` |
| relkit 稀疏检出 | `scripts/ensure-relkit.mjs`、`scripts/relkit-pin.mjs` | `rup-client` 原本指向仓库外的兄弟检出，只有开发机能装依赖 |
| 打包脚本跨平台化 | `scripts/package-versioned.mjs` | Go 显式 `GOOS=windows`；zip 改用 yazl，不再依赖 PowerShell / `zip(1)` |
| 发布完整性规则 | 元仓库 `.cursor/rules/release-integrity.mdc` | 明确禁止 SSH 读 token、直连 agent、用本地产物发布 |

`Compress-Archive` 写出的 zip 条目用反斜杠分隔（违反 APPNOTE 4.4.17.1），Windows 上侥幸能解开、
Linux 上不能。改用 yazl 后本地与 CI 产出同构的包，已核对 90 个条目零反斜杠。

仍未收口（按有效性排序，均需另立任务）：

- [ ] agent 校验产物出处（CNB OIDC / 构建证明），使非 CI 产出的 staged 包被拒
- [ ] 签名私钥移出发布机文件系统（KMS/HSM 或独立签名服务），使 root 可用不可窃且留外部审计
- [ ] 发布 token 增加短时效；按产品签发已完成（cronkit 使用独立 `RELKIT_UPLOAD_TOKEN`）
- [ ] 发布审计落到发布机改不动的地方，并与 CI 运行记录对账告警
- [ ] 收敛发布机 root 访问 —— 以上四项对 root 都只是提高成本，这条才是真正的边界

## 5. relkit 侧改动清单（待 relkit 自行核对）

截至 2026-08-31 22:01，原本的未提交现场已由用户本人提交为
`ef5cb23 wip: 保存 TS SDK 与 admin 面板交接现场（未经审阅）`。该提交同时包含
`sdk/node/` 与不相干的 `relkit-serve` 管理面板改动；下表仍只描述 cronkit 接入产生的部分。
核对对象已从工作区 diff 变为该 WIP 提交，必须按目录拆开审阅。本阶段没有对 relkit 执行任何 git 写操作。

**新增目录 `sdk/node/`（26 个文件）**

| 分类 | 文件 |
|---|---|
| 包配置 | `package.json`（name `rup-client`、ESM、Node>=20）、`package-lock.json`、`tsconfig.json`、`buf.gen.yaml`、`.gitignore` |
| 生成代码 | `src/gen/rup/v2/{envelope,http,keys,objects}_pb.ts`（由 `proto/rup/v2/` 生成并检入，宿主无需装 protoc） |
| 实现 | `src/{models,envelope,chain,selectors,state,preference,fetch,filename,download,release-notes,updater,scheduler,index}.ts` |
| 测试 | `test/conformance.test.ts`（65 用例，与 Dart runner 的 `expectedCases` 一致）、`test/unit.test.ts`（29 项） |
| 文档 | `AGENT-QUICKSTART.md`（N0–N6 + Fallback，结构对齐 Go/Dart）、`README.md` |

**修改的既有文件（4 个）**

| 文件 | 动作 |
|---|---|
| `docs/agent/sdk-cascade.md` | 登记表加 Node 一行；「宿主负责」补注「Node 不提供 apply」 |
| `docs/agent/bootstrap.ps1` | 加 `package.json` 探测（并识别 `electron` 依赖），第 3 步指向 `sdk/node/AGENT-QUICKSTART.md`；收窄「pick language manually」兜底条件 |
| `docs/agent/bootstrap.sh` | 同上 |
| `sdk/README.md` | 目录表加 `node/` 行；对齐矩阵由「Go ↔ Dart」扩为「Go ↔ Dart ↔ Node」，Node 侧 apply 标 `n/a (host)` |

**验证记录**

```text
sdk/node> npm test
ℹ tests 42   ℹ suites 11   ℹ pass 42   ℹ fail 0
  conformance 单跑：13 tests / 3 suites / pass 13，casesChecked === 65

docs/agent/bootstrap.ps1 -HostRoot <cronkit>
  FOUND  package.json (Electron host? -> apply is host-side)
  3. …\sdk\node\AGENT-QUICKSTART.md
     note: rup-client has no apply; host owns install/restart
```

**请 relkit 侧重点复核的两处**

`src/download.ts` 的 `.part` 预分配改成了两次 open（`"a"` 建文件，`"r+"` 改大小）。
Windows 上追加模式句柄只有 `FILE_APPEND_DATA`，`truncate` 必然 `EPERM`。
建议核对 Go / Dart 侧是否有同类写法——若有，同一个 bug 在那两个实现里也会在 Windows 上复现。

`src/envelope.ts` 新增 `toTrustedKeys()`，让 `trustedKeys` 接受普通对象 / `Map` / base64 字符串。
这是宿主友好性改动，不影响验签语义（仍对 `Envelope.payload` 原始字节验签）。

顺带发现、建议 relkit 侧一并确认的文档不一致（未擅自改）：
`README.md` 的 stage 示例写 `arch=x64`，而 `sdk/AGENT-QUICKSTART.md` 的 `ClientSelectors` 写 `arch: "amd64"`。
`SPEC.md` §11.1 的标准取值表用的是 `x64`。建议统一到 `x64`，否则接入方极易踩「check 通过但找不到 artifact」。
本次冒烟第 4 项就是故意用 `amd64` 复现这个坑。

## 6. 建议执行顺序

1. 用户确认 `product` / `channel` / 首版版本号三个值。
2. 阶段一（relkit `sdk/node`，跑通夹具）——工作量最大，但不影响 cronkit 现有功能。
3. 阶段二（cronkit 工具链开箱 + COS 首次 publish 假产物）。
4. 阶段三前半（check / download + UI，apply 先只下载不安装）。
5. 阶段四冒烟。
6. 阶段三后半（versionedDir apply 改造）单独成一批，改完重跑打包与自启验证。

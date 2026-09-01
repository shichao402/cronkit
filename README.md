# 工作目录编排器

Windows 托盘程序：按 YAML 调度 SVN 更新、Unity 预热和本地脚本。配置以**自动化任务**为主（触发器 + 一个或多个目标目录与步骤）。

项目文档在 [`document/`](document/README.md)（adr / architecture / roadmap）。脚本在 `scripts/`。

## 启动

```bat
cd /d D:\workspace\GitHub\AgentsHelpMe\_work\cronkit
npm install
npm start
```

首次启动会在 `%APPDATA%\cronkit\config.yaml` 写入一份探测到的本机配置（v2）。若本机还有旧目录 `%APPDATA%\workspace-orchestrator`，会把配置、状态、日志和 toolset 迁过去。打开旧 v1 配置会在内存中迁移预览，**点保存**后才写成 v2。默认**不启用自动调度**，避免未经确认就 `svn update`。

关闭窗口会缩到托盘。托盘右键可退出。

只改面板外观、不想开 Electron 时，用浏览器 mock（不是应用本身）：

```bat
npm run ui-preview
:: 可选场景：?scenario=empty|broken|conflict|validate-fail
```

说明在 [`tools/ui-preview/README.md`](tools/ui-preview/README.md)。面板是全站 React；配置在应用内用表单编辑，需要直接改 YAML 时用「外部编辑器」。

## 测试

```bat
npm test
```

## 打包

```bat
cd /d D:\workspace\GitHub\AgentsHelpMe\_work\cronkit
npm install
npm run dist
```

产物：`dist\cronkit-<version>-win-x64.zip`。这是包含稳定 launcher、
`relkit-apply.exe` 与 `versions/<version>/` 的 versionedDir 发布包；
`.release\win-unpacked` 只是被忽略的构建中间目录，不能直接发布。

## 发版

项目已经完成 relkit 开箱。准备发版时必须先读当前版本的 `relkit agent-guide`，
不要从开箱计划复制命令，也不要把本机 `publishTo: ["local"]` 改成 COS 后直接发布。

生产拓扑固定为：

```text
开发机 / CI：build + relkit stage
  → publish.firoyang.com / relkit-agent：持签名私钥与 COS 凭据并执行 publish
  → raw.firoyang.com / COS：客户端匿名只读
```

新产品必须先用发布机本地的 `relkit-agent init ... -product <id>` 登记，并把生产
`relkit.json` 与签名密钥放入对应产品 root；登记后需经明确批准重启 agent 才生效。
`relkit-serve` 的 PUT 是遗留路径，cronkit 不注册 serve token。

发布红线：

- 版本唯一来源是 `VERSION.json`，改号只用 `relkit version ...`。
- CI 只持 `RELKIT_AGENT_TOKEN`，不持签名私钥或 COS SecretKey。
- 发布前依次完成 `stage`、`simulate --with-staged ... --from all` 与 dry-run。
- 通过 agent 发布后再做 directory 更新与 `verify --deep`，禁止手工上传或编辑远端签名对象。

## CLI

```bat
npm run cli -- validate
npm run cli -- status
npm run cli -- run --target osg-trunk1 --dry-run
npm run cli -- run --workspace osg-trunk1
npm run cli -- run --task after-midnight
```

`--workspace` 仍可用，等同 `--target`（目标目录 id）。

## 配置要点

- 顶层是 `tasks`；步骤写 `uses: builtin/svn-update`（也兼容旧 `type:` 写法，保存后会规范化）
- 任务 / 目标 / 模板的 `id` 由程序自动分配、界面只读；要区分目录请改「显示名」
- 多个目录步骤相同时抽成**步骤模板**：顶层 `stepTemplates` 定义一次，目标写 `usesTemplate: <模板 id>` 引用，一处改动全部生效
- 模板中用 `${变量名}` 表达目录间差异，在模板的 `vars` 里声明（可给 `default`），各目标用 `vars` 填自己的值；内置可直接用 `${target.path}` / `${target.name}` / `${target.id}`
- 某个目录要单独调整时，在面板上「解除引用」把模板展开成它独有的步骤
- `svn-update` 的 `with.strategy`: `follow-latest` / `manual` / `disabled`
- `svn-update` / `svn-revert` 的 `with.releaseOccupants`（默认 true）：Windows 上按本次将写入的文件查占用并结束进程；不想强杀就设 `false`
- Unity 工程若在 SVN 根下的 `Project/`，在步骤上写 `path: Project`
- 密钥不要写入 YAML


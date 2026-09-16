# 工作目录编排器

Windows 托盘程序：按 YAML 调度 SVN 更新、Unity 预热和本地脚本。配置以**自动化任务**为主（触发器 + 一个或多个目标目录与步骤）。

项目文档在 [`document/`](document/README.md)（adr / architecture / roadmap）。脚本在 `scripts/`。

## 启动

```bat
cd /d D:\workspace\GitHub\cronkit
npm install
npm start
```

`npm install` 前需要 lock 钉住的 bindings：

```bat
python scripts/host/relkit_host.py install
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
cd /d D:\workspace\GitHub\cronkit
npm install
npm run dist
```

产物：

- `dist\cronkit-<version>-win-x64.zip`：versionedDir 发布包（稳定 launcher、
  `relkit-updater.exe`、`active.json`、`versions/<version>/`），供自动更新。
- `dist\cronkit-<version>-win-x64-setup.exe`：NSIS 首次安装包，安装树与 zip 同源。

`.release\win-unpacked` 只是被忽略的构建中间目录，不能直接发布。
本地需要已安装 [NSIS 3](https://nsis.sourceforge.io/)（`makensis` 在 PATH，或设 `MAKENSIS`）。

本地打包**只用于验证**，产物不要拿去发布（见下）。Go launcher 以
`GOOS=windows GOARCH=amd64` 交叉编译，sidecar 来自 `tools/bin/relkit-updater.exe`，
zip 由 yazl 生成，因此非 Windows 宿主也能打出与 CI 同构的 zip；**NSIS setup.exe
只在 Windows（本机或 `windows-latest` CI）生成**。

## 发版

发布只由 GitHub Actions（[`.github/workflows/release.yml`](.github/workflows/release.yml)）执行。
改版本号、推 tag，其余交给 CI：

```bat
:: 1. 改版本号（唯一来源是 VERSION.json）
relkit version bump build
npm run sync-version
git commit -am "chore(release): 0.1.0+2" && git push

:: 2. 打渠道 tag 触发发布
git tag beta/v0.1.0+2 && git push origin beta/v0.1.0+2
```

`beta/v*` 进 beta 渠道，`stable/v*` 进 stable。tag 里的版本必须与 `VERSION.json`
完全一致，否则流水线在第一步就失败。

生产拓扑固定为：

```text
GitHub Actions：build + relkit stage（只持 cronkit 专属 RELKIT_UPLOAD_TOKEN）
  → publish.firoyang.com / relkit-agent：持签名私钥与 COS 凭据并执行 publish
  → raw.firoyang.com / COS：客户端匿名只读
```

发布红线：

- 版本唯一来源是 `VERSION.json`，改号只用 `relkit version ...`。
- CI 只持发布 agent 的 Bearer，不持签名私钥或 COS SecretKey。
- **不要**从开发机发布：不 SSH 到发布机读 token，不直连 `127.0.0.1` 调 agent，
  不用本地构建的产物走 `/v1/publish`。理由见元仓库的发布完整性规则。
- 流水线跑不通时修流水线，不要绕过它补发这一次。
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


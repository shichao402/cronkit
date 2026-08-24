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

## 打包 exe

```bat
cd /d D:\workspace\GitHub\AgentsHelpMe\_work\cronkit
npm install
npm run dist
```

产物：`dist\win-unpacked\WorkspaceOrchestrator.exe`


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
- `svn-update` 的 `with.strategy`: `follow-latest` / `manual` / `disabled`
- `svn-update` / `svn-revert` 的 `with.releaseOccupants`（默认 true）：Windows 上按本次将写入的文件查占用并结束进程；不想强杀就设 `false`
- Unity 工程若在 SVN 根下的 `Project/`，在步骤上写 `path: Project`
- 密钥不要写入 YAML

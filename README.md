# 工作目录编排器

Windows 托盘程序：按 YAML 调度 SVN 更新、Unity 预热和本地脚本。

## 启动

```bat
cd /d D:\workspace\GitHub\AgentsHelpMe\_work\workspace-orchestrator
npm install
npm start
```

首次启动会在 `%APPDATA%\workspace-orchestrator\config.yaml` 写入一份探测到的本机配置。默认**不启用自动调度**，避免未经确认就 `svn update`。

关闭窗口会缩到托盘。托盘右键可退出。

## 打包 exe

```bat
cd /d D:\workspace\GitHub\AgentsHelpMe\_work\workspace-orchestrator
npm install
npm run dist
```

产物：`dist\win-unpacked\WorkspaceOrchestrator.exe`


## CLI

```bat
npm run cli -- validate
npm run cli -- status
npm run cli -- run --workspace osg-trunk1 --dry-run
npm run cli -- run --workspace osg-trunk1
```

## 配置要点

- `svn-update.strategy`: `follow-latest` / `manual` / `disabled`
- Unity 工程若在 SVN 根下的 `Project/`，在 `unity-warmup` 上写 `path: Project`
- 密钥不要写入 YAML

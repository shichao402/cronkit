# 0008. 工具集检出更新时以远端为准

- 状态：accepted
- 日期：2026-08-25

## 背景

`%APPDATA%\cronkit\toolsets\<id>` 是应用替用户 clone 的检出，界面上只有一个「更新」按钮。原实现走 `git pull --ff-only`：只要检出里有本地改动，git 就中止并把 `Your local changes would be overwritten by merge` 原样抛到界面上，用户在应用里没有任何手段解决——既不能 commit，也不能 stash。

实际发生过：在这个检出里直接写了新工具，同样的工作又从别处提交推到了远端，之后每次点更新都失败。

## 决定

更新已存在的检出改为 `git fetch origin <branch>` + `git reset --hard origin/<branch>`，不再 `pull`。重置前若有已跟踪文件的改动，先把 `git diff` 存成 `logs/toolset-install/<id>-local-<时间戳>.patch` 并写进安装日志。

不跑 `git clean`：未跟踪文件不会挡住 reset，而 `.venv` 就在检出里，清掉会导致每次更新重装依赖。

## 备选

- 保持 `pull --ff-only`，失败时给更友好的提示：用户仍然卡住，应用里没有解决入口。
- 自动 commit 或 stash 本地改动：在一个用户不该直接编辑的目录里攒历史/stash 栈，越积越乱。
- 直接 `reset --hard` 不备份：这次的本地改动恰好远端已有，但下次未必；备份很便宜。

## 后果

- 工具集目录里的手改一律会被下次更新覆盖，只在 patch 备份里留痕。要改工具就改上游仓库。
- 远端 force push / 换分支也能正常更新，不再要求可快进。

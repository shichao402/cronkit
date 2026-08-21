# 面板浏览器预览

这不是 Cronkit 应用。

`npm start` 走 Electron + 主进程 + 真实 `window.api`。本目录是一个**独立的 Vite 站点**：在浏览器里挂上假的 `window.api` 和一份写死的 Snapshot，用来改 `src/renderer` 时看布局，不必启动托盘程序。

- 入口只在这里；`src/renderer/` 里没有预览文件。
- `electron-vite` / `electron-builder` 不会打包本目录。
- 顶部紫色条是故意的，避免和正式面板搞混。
- 配置页已是 React；mock 支持若干场景查询参数。

```bat
npm run ui-preview
```

浏览器打开 <http://localhost:5199>。

| 参数 | 作用 |
| --- | --- |
| `?theme=light` | 浅色主题 |
| `?scenario=empty` | 空任务列表 |
| `?scenario=broken` | YAML 解析失败 |
| `?scenario=migrate` | v1 迁移警告 |
| `?scenario=conflict` | 保存冲突 |
| `?scenario=validate-fail` | 校验失败 |

点「运行 / 打开目录」只会 toast；配置页的保存走 mock，不会动真实磁盘或 SVN。

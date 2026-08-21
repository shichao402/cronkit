# 面板浏览器预览

这不是 Cronkit 应用。

`npm start` 走 Electron + 主进程 + 真实 `window.api`。本目录是一个**独立的 Vite 站点**：在浏览器里挂上假的 `window.api` 和一份写死的 Snapshot，用来改 `src/renderer` 时看布局，不必启动托盘程序。

- 入口只在这里；`src/renderer/` 里没有预览文件。
- `electron-vite` / `electron-builder` 不会打包本目录。
- 顶部紫色条是故意的，避免和正式面板搞混。

```bat
npm run ui-preview
```

浏览器打开 <http://localhost:5199>。浅色主题加 `?theme=light`。

点「运行 / 保存 / 打开目录」只会 toast，不会动磁盘或 SVN。

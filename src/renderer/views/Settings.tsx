import type { ThemePref } from "../../shared/types";
import { useSnapshot } from "../components/SnapshotContext";
import { useToast } from "../components/Toast";
import { UpdateSection } from "./UpdateSection";

const THEME_TOASTS: Record<ThemePref, string> = {
  system: "主题已跟随系统",
  light: "已切换浅色主题",
  dark: "已切换深色主题",
};

export function Settings() {
  const { snapshot, setSnapshot, api, refresh } = useSnapshot();
  const { toast, handle } = useToast();

  if (!snapshot) {
    return null;
  }

  const openPath = (kind: "config" | "logs" | "data", label: string) => {
    void handle(async () => {
      const call =
        kind === "config"
          ? api.openConfig
          : kind === "logs"
            ? api.openLogs
            : api.openDataDir;
      const result = await call();
      if (!result.ok) {
        throw new Error(result.error ?? `无法打开${label}`);
      }
      toast(`已打开${label}`);
    }, `正在打开${label}…`);
  };

  return (
    <section className="view">
      <header className="page-head">
        <div className="page-title">
          <h1>设置</h1>
          <p className="page-sub">外观、调度行为、更新与文件位置</p>
        </div>
      </header>

      <div className="settings">
        <section className="setting-group">
          <h2>外观</h2>
          <div className="setting-row">
            <div className="setting-text">
              <div className="name">主题</div>
              <div className="desc">同时影响界面配色、托盘图标和窗口图标</div>
            </div>
            <div className="setting-control seg" role="group" aria-label="主题">
              {(["system", "light", "dark"] as ThemePref[]).map((theme) => (
                <button
                  key={theme}
                  type="button"
                  aria-pressed={snapshot.theme === theme}
                  onClick={() =>
                    void handle(async () => {
                      await api.setTheme(theme);
                      await refresh();
                      toast(THEME_TOASTS[theme]);
                    }, THEME_TOASTS[theme])
                  }
                >
                  {theme === "system" ? "跟随系统" : theme === "light" ? "浅色" : "深色"}
                </button>
              ))}
            </div>
          </div>
        </section>

        <section className="setting-group">
          <h2>调度</h2>
          <div className="setting-row">
            <div className="setting-text">
              <div className="name">启用自动调度</div>
              <div className="desc">关闭后仅保留手动运行，计划任务不会触发</div>
            </div>
            <label className="setting-control switch">
              <input
                type="checkbox"
                checked={snapshot.schedulerEnabled}
                onChange={(event) =>
                  void handle(async () => {
                    await api.setSchedulerEnabled(event.target.checked);
                    setSnapshot(await api.getSnapshot());
                  }, event.target.checked ? "已启用自动调度" : "已关闭自动调度")
                }
              />
              <span className="track" />
            </label>
          </div>
          <div className="setting-row">
            <div className="setting-text">
              <div className="name">登录时启动</div>
              <div className="desc">开机登录后静默启动并驻留托盘</div>
            </div>
            <label className="setting-control switch">
              <input
                type="checkbox"
                checked={snapshot.openAtLogin}
                onChange={(event) =>
                  void handle(async () => {
                    await api.setOpenAtLogin(event.target.checked);
                    setSnapshot({ ...snapshot, openAtLogin: event.target.checked });
                  }, event.target.checked ? "已开启登录启动" : "已关闭登录启动")
                }
              />
              <span className="track" />
            </label>
          </div>
        </section>

        <UpdateSection timezone={snapshot.timezone} />

        <section className="setting-group">
          <h2>文件位置</h2>
          <div className="setting-row">
            <div className="setting-text">
              <div className="name">配置文件</div>
              <div className="desc mono">{snapshot.configPath}</div>
            </div>
            <button
              type="button"
              className="btn btn-quiet btn-sm setting-control"
              onClick={() => openPath("config", "配置文件")}
            >
              打开
            </button>
          </div>
          <div className="setting-row">
            <div className="setting-text">
              <div className="name">日志目录</div>
              <div className="desc">每次运行的完整输出都写在这里</div>
            </div>
            <button
              type="button"
              className="btn btn-quiet btn-sm setting-control"
              onClick={() => openPath("logs", "日志目录")}
            >
              打开
            </button>
          </div>
          <div className="setting-row">
            <div className="setting-text">
              <div className="name">数据目录</div>
              <div className="desc mono">{snapshot.dataDir}</div>
            </div>
            <button
              type="button"
              className="btn btn-quiet btn-sm setting-control"
              onClick={() => openPath("data", "数据目录")}
            >
              打开
            </button>
          </div>
        </section>
      </div>
    </section>
  );
}

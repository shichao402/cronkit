import { useCallback, useEffect, useRef, useState } from "react";
import type { IconName } from "./icons";
import { Icon } from "./components/Icon";
import { SnapshotProvider, useSnapshot } from "./components/SnapshotContext";
import { ToastProvider, useToast } from "./components/Toast";
import { Dashboard } from "./views/Dashboard";
import { Settings } from "./views/Settings";
import { ConfigPage } from "./views/ConfigPage";
import { Toolsets } from "./views/Toolsets";

export type View = "dash" | "config" | "toolsets" | "settings";

const STATE_LABELS: Record<string, string> = {
  running: "运行中",
  failed: "今日有失败",
  paused: "已停用",
  idle: "空闲",
};

const NAV: Array<{ view: View; label: string; glyph: IconName }> = [
  { view: "dash", label: "仪表盘", glyph: "gauge" },
  { view: "config", label: "配置", glyph: "sliders" },
  { view: "toolsets", label: "工具集", glyph: "layers" },
  { view: "settings", label: "设置", glyph: "gear" },
];

export function App() {
  return (
    <ToastProvider>
      <SnapshotProvider>
        <AppShell />
      </SnapshotProvider>
    </ToastProvider>
  );
}

function AppShell() {
  const { snapshot, setSnapshot, api, refresh } = useSnapshot();
  const { toast, handle } = useToast();
  const [view, setView] = useState<View>("dash");
  const [configDirty, setConfigDirty] = useState(false);
  const [focusTaskId, setFocusTaskId] = useState<string | undefined>();
  const viewRef = useRef(view);
  const dirtyRef = useRef(configDirty);
  viewRef.current = view;
  dirtyRef.current = configDirty;

  const go = useCallback((next: View) => {
    if (viewRef.current === "config" && next !== "config" && dirtyRef.current) {
      const leave = window.confirm("配置有未保存的修改，离开后会丢失。仍要离开吗？");
      if (!leave) {
        return;
      }
    }
    setView(next);
    document.querySelector(".content")?.scrollTo({ top: 0 });
  }, []);

  const openConfig = useCallback(
    (taskOrTargetId?: string) => {
      const taskId = snapshot?.workspaces.find(
        (item) => item.id === taskOrTargetId || item.taskId === taskOrTargetId,
      )?.taskId;
      setFocusTaskId(taskId ?? taskOrTargetId);
      go("config");
    },
    [go, snapshot?.workspaces],
  );

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!event.ctrlKey || event.altKey) {
        return;
      }
      const map: Record<string, View> = {
        "1": "dash",
        "2": "config",
        "3": "toolsets",
        "4": "settings",
      };
      const next = map[event.key];
      if (!next) {
        return;
      }
      event.preventDefault();
      if (next === "config") {
        openConfig();
        return;
      }
      go(next);
      void refresh();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go, openConfig, refresh]);

  const paused = snapshot?.appState === "idle" && !snapshot.schedulerEnabled;
  const navState = paused ? "paused" : (snapshot?.appState ?? "idle");
  const banners = buildBanners(snapshot);

  return (
    <div className="app">
      <aside className="sidenav">
        <div className="brand">
          <span className="brand-mark" aria-hidden>
            CK
          </span>
          <span className="brand-text">
            <strong>Cronkit</strong>
            <small>工作目录编排器</small>
          </span>
        </div>

        <div className={`nav-state ${navState}`} title={`当前状态：${STATE_LABELS[navState]}`}>
          <span className="state-dot" />
          <span className="state-label">{STATE_LABELS[navState]}</span>
        </div>

        <nav className="nav" role="tablist" aria-label="主导航">
          {NAV.map((item) => {
            const active = view === item.view;
            return (
              <button
                key={item.view}
                type="button"
                className={`nav-item${active ? " is-active" : ""}`}
                role="tab"
                aria-selected={active}
                onClick={() => {
                  if (item.view === "config") {
                    openConfig();
                    return;
                  }
                  go(item.view);
                  void refresh();
                }}
              >
                <span className="nav-glyph">
                  <Icon name={item.glyph} />
                </span>
                <span className="nav-label">{item.label}</span>
                {item.view === "config" && (
                  <span
                    className={`nav-dot${configDirty ? "" : " hidden"}`}
                    title="有未保存修改"
                  />
                )}
              </button>
            );
          })}
        </nav>

        <div className="nav-foot">
          <button
            type="button"
            className="nav-file"
            title={
              snapshot
                ? `用外部编辑器打开 ${snapshot.configPath}`
                : "用外部编辑器打开配置文件"
            }
            onClick={() =>
              void handle(async () => {
                const result = await api.openConfig();
                if (!result.ok) {
                  throw new Error(result.error ?? "无法打开配置文件");
                }
                toast("已用外部编辑器打开配置文件");
              }, "正在用外部编辑器打开配置文件…")
            }
          >
            <span className="nav-file-key">
              <span className="nav-glyph">
                <Icon name="terminal" />
              </span>
              配置文件
            </span>
            <span className="nav-file-value">{snapshot?.configPath ?? "正在加载…"}</span>
          </button>
        </div>
      </aside>

      <main className="content">
        <div className="banners" aria-live="polite">
          {banners.map((banner) => (
            <div key={banner.title} className={`banner banner-${banner.kind}`}>
              <Icon name={banner.glyph} />
              <div>
                <div className="banner-title">{banner.title}</div>
                {banner.body && <div className="banner-body">{banner.body}</div>}
              </div>
              {banner.action ? (
                <button
                  type="button"
                  className="btn btn-sm btn-quiet"
                  onClick={() => {
                    if (banner.action === "reload") {
                      void handle(async () => {
                        setSnapshot(await api.reloadConfig());
                        toast("已重新加载配置");
                      }, "正在重新加载配置…");
                    }
                    if (banner.action === "enable-scheduler") {
                      void handle(async () => {
                        await api.setSchedulerEnabled(true);
                        setSnapshot(await api.getSnapshot());
                      }, "已启用自动调度");
                    }
                  }}
                >
                  {banner.action === "reload" ? "重新加载" : "启用"}
                </button>
              ) : (
                <span />
              )}
            </div>
          ))}
        </div>

        {view === "dash" && (
          <Dashboard onEditTarget={openConfig} onGotoConfig={() => openConfig()} />
        )}
        {view === "config" && (
          <ConfigPage
            focusTaskId={focusTaskId}
            onDirtyChange={setConfigDirty}
            onOpenExternal={() =>
              void handle(async () => {
                const result = await api.openConfig();
                if (!result.ok) {
                  throw new Error(result.error ?? "无法打开配置文件");
                }
                toast("已用外部编辑器打开配置文件");
              }, "正在用外部编辑器打开配置文件…")
            }
          />
        )}
        {view === "toolsets" && <Toolsets />}
        {view === "settings" && <Settings />}
      </main>
    </div>
  );
}

function buildBanners(
  snapshot: ReturnType<typeof useSnapshot>["snapshot"],
): Array<{
  kind: "fail" | "warn" | "info";
  glyph: IconName;
  title: string;
  body?: string;
  action?: "reload" | "enable-scheduler";
}> {
  if (!snapshot) {
    return [];
  }
  const banners: Array<{
    kind: "fail" | "warn" | "info";
    glyph: IconName;
    title: string;
    body?: string;
    action?: "reload" | "enable-scheduler";
  }> = [];
  if (snapshot.configError) {
    banners.push({
      kind: "fail",
      glyph: "alert",
      title: "配置无法加载",
      body: snapshot.configError,
      action: "reload",
    });
  }
  if (!snapshot.schedulerEnabled) {
    banners.push({
      kind: "warn",
      glyph: "clock",
      title: "自动调度已关闭",
      body: "计划任务不会触发，只能从这里手动运行。",
      action: "enable-scheduler",
    });
  }
  if (snapshot.exitWarnsRunning) {
    banners.push({
      kind: "info",
      glyph: "hand",
      title: "有任务正在运行",
      body: "退出程序会中断当前任务。",
    });
  }
  return banners;
}

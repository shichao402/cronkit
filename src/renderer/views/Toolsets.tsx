import { useEffect, useState } from "react";
import type { ToolsetView } from "../../shared/types";
import { Icon } from "../components/Icon";
import { useSnapshot } from "../components/SnapshotContext";
import { useToast } from "../components/Toast";

export function Toolsets() {
  const { snapshot, setSnapshot, api } = useSnapshot();
  const { toast, handle } = useToast();

  if (!snapshot) {
    return null;
  }

  const toolsets = snapshot.toolsets ?? [];
  return (
    <section className="view">
      <header className="page-head">
        <div className="page-title">
          <h1>工具集</h1>
          <p className="page-sub">管理任务可用的工具、仓库来源与本地安装</p>
        </div>
      </header>

      <div className="toolset-grid">
        {toolsets.map((toolset) => (
          <ToolsetCard
            key={toolset.id}
            toolset={toolset}
            onSaveRepo={(repo) =>
              void handle(async () => {
                setSnapshot(await api.setToolsetRepo(toolset.id, repo));
                toast(`${toolset.displayName} 的仓库地址已保存`);
              }, "正在保存仓库地址…")
            }
            onUpdate={() =>
              void handle(async () => {
                setSnapshot(await api.updateToolset(toolset.id));
                toast(`${toolset.displayName} 已更新`);
              }, `正在下载/更新 ${toolset.displayName}…`)
            }
          />
        ))}
      </div>
    </section>
  );
}

function ToolsetCard({
  toolset,
  onSaveRepo,
  onUpdate,
}: {
  toolset: ToolsetView;
  onSaveRepo: (repo: string) => void;
  onUpdate: () => void;
}) {
  const [repo, setRepo] = useState(toolset.repo ?? "");

  useEffect(() => {
    setRepo(toolset.repo ?? "");
  }, [toolset.repo]);

  const ready = toolset.installed && toolset.depsReady;
  const status = ready
    ? `已就绪 · schema v${toolset.schemaVersion}${toolset.sha ? ` · ${toolset.sha.slice(0, 7)}` : ""}`
    : toolset.installed
      ? `依赖未就绪 · ${toolset.error ?? "原因未知"}`
      : `未安装 · ${toolset.error ?? "点击下载"}`;

  return (
    <article className="toolset">
      <div className="toolset-head">
        <span className={`state-dot ${ready ? "succeeded" : "failed"}`} />
        <h3>{toolset.displayName}</h3>
        <span className="chip chip-mono">{toolset.id}</span>
      </div>
      <div className="toolset-meta">
        <span>{status}</span>
        <span className="toolset-root" title={toolset.root}>
          {toolset.root}
        </span>
      </div>

      {toolset.repo && (
        <div className="toolset-repo">
          <label htmlFor={`toolset-repo-${toolset.id}`}>仓库地址</label>
          <div className="toolset-repo-row">
            <input
              id={`toolset-repo-${toolset.id}`}
              className="mono"
              value={repo}
              onChange={(event) => setRepo(event.target.value)}
              placeholder="https://…/toolset.git"
            />
            <button
              type="button"
              className="btn btn-sm btn-quiet"
              disabled={!repo.trim() || repo.trim() === toolset.repo}
              onClick={() => onSaveRepo(repo.trim())}
            >
              保存
            </button>
          </div>
          <p>更新时会从此地址拉取；已安装仓库的 origin 也会同步修改。</p>
        </div>
      )}

      <div className="toolset-tools">
        {toolset.tools.length ? (
          toolset.tools.map((tool) => (
            <span
              key={tool.id}
              className="chip chip-mono"
              title={tool.description || tool.id}
            >
              {tool.displayName || tool.id}
            </span>
          ))
        ) : (
          <span className="chip chip-muted">没有工具</span>
        )}
      </div>

      {toolset.id !== "builtin" && (
        <div className="chip-row">
          <button type="button" className="btn btn-sm" onClick={onUpdate}>
            <Icon name="download" />
            {toolset.installed ? "更新" : "下载"}
          </button>
        </div>
      )}
    </article>
  );
}

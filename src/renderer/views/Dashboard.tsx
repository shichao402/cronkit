import { useEffect, useState } from "react";
import type { RunRecord, Snapshot, WorkspaceView } from "../../shared/types";
import {
  dayLabel,
  formatAbsolute,
  relLabel,
  runSpan,
  spanOf,
  splitStepLabel,
  STATUS_LABELS,
  today,
  TRIGGER_LABELS,
  truncateMiddle,
} from "../format";
import type { IconName } from "../icons";
import { Icon } from "../components/Icon";
import { useSnapshot } from "../components/SnapshotContext";
import { useToast } from "../components/Toast";

type Props = {
  onEditTarget: (targetId: string) => void;
  onGotoConfig: () => void;
};

export function Dashboard({ onEditTarget, onGotoConfig }: Props) {
  const { snapshot, setSnapshot, api, refresh } = useSnapshot();
  const { toast, handle } = useToast();
  const [runFilter, setRunFilter] = useState<"all" | "failed">("all");
  const [openRuns, setOpenRuns] = useState<Set<string>>(() => new Set());
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);

  if (!snapshot) {
    return (
      <section className="view">
        <header className="page-head">
          <div className="page-title">
            <h1>仪表盘</h1>
            <p className="page-sub">正在加载…</p>
          </div>
        </header>
      </section>
    );
  }

  return (
    <section className="view">
      <header className="page-head">
        <div className="page-title">
          <h1>仪表盘</h1>
          <p className="page-sub">
            时区 {snapshot.timezone} · 自动调度{snapshot.schedulerEnabled ? "已启用" : "已关闭"}
          </p>
        </div>
        <div className="page-actions">
          <button
            type="button"
            className="btn"
            onClick={() =>
              void handle(async () => {
                setSnapshot(await api.catchUp());
                toast("已触发补跑");
              }, "正在补跑…")
            }
          >
            <Icon name="refresh" />
            立即补跑
          </button>
          <button
            type="button"
            className="btn btn-quiet"
            onClick={() =>
              void handle(async () => {
                const result = await api.openLogs();
                if (!result.ok) {
                  throw new Error(result.error ?? "无法打开日志目录");
                }
                toast("已打开日志目录");
              }, "正在打开日志目录…")
            }
          >
            <Icon name="folder" />
            日志目录
          </button>
        </div>
      </header>

      <Stats snapshot={snapshot} now={now} />

      <section className="block">
        <div className="block-head">
          <h2>今日计划</h2>
          <span className="block-count">{workspaceCountLabel(snapshot)}</span>
        </div>
        <div className="rows">
          <WorkspaceList
            snapshot={snapshot}
            now={now}
            onRun={(id) =>
              void handle(async () => {
                setSnapshot(await api.runWorkspace(id));
                toast(`已开始运行 ${id}`);
              }, `正在启动 ${id}…`)
            }
            onCancel={(runId) =>
              void handle(async () => {
                await api.cancelRun(runId);
                await refresh();
                toast("已请求取消");
              }, "正在取消…")
            }
            onEdit={onEditTarget}
            onGotoConfig={onGotoConfig}
          />
        </div>
      </section>

      <section className="block">
        <div className="block-head">
          <h2>最近执行</h2>
          <div className="seg" role="group" aria-label="筛选执行记录">
            <button
              type="button"
              aria-pressed={runFilter === "all"}
              onClick={() => setRunFilter("all")}
            >
              全部
            </button>
            <button
              type="button"
              aria-pressed={runFilter === "failed"}
              onClick={() => setRunFilter("failed")}
            >
              仅失败
            </button>
          </div>
        </div>
        <div className="rows">
          <RunList
            snapshot={snapshot}
            now={now}
            runFilter={runFilter}
            openRuns={openRuns}
            onToggle={(runId) => {
              setOpenRuns((prev) => {
                const next = new Set(prev);
                if (next.has(runId)) {
                  next.delete(runId);
                } else {
                  next.add(runId);
                }
                return next;
              });
            }}
          />
        </div>
      </section>

    </section>
  );
}

function workspaceCountLabel(snapshot: Snapshot): string {
  const items = snapshot.workspaces;
  if (!items.length) {
    return "";
  }
  const auto = items.filter((item) => item.autoScheduled).length;
  return `${items.length} 个 · ${auto} 个自动调度`;
}

function Stats({ snapshot, now }: { snapshot: Snapshot; now: number }) {
  const day = today(snapshot.timezone);
  const todays = snapshot.runs.filter((run) => run.localDate === day);
  const succeeded = todays.filter((run) => run.status === "succeeded").length;
  const failed = todays.filter((run) => run.status === "failed");
  const running = snapshot.workspaces.filter((item) => item.running);
  const upcoming = snapshot.workspaces
    .filter((item) => item.autoScheduled && item.nextRun)
    .sort((a, b) => (a.nextRun! < b.nextRun! ? -1 : 1))[0];

  const next: {
    key: string;
    glyph: IconName;
    value: string;
    sub: string;
    tone: string;
    small?: boolean;
  } = !snapshot.schedulerEnabled
    ? { key: "下次运行", glyph: "clock", value: "已暂停", sub: "自动调度已关闭", tone: "muted", small: true }
    : upcoming
      ? {
          key: "下次运行",
          glyph: "clock",
          value: dayLabel(upcoming.nextRun!, snapshot.timezone),
          sub: `${upcoming.name} · ${relLabel(upcoming.nextRun!, now) || formatAbsolute(upcoming.nextRun!, snapshot.timezone)}`,
          tone: "plain",
          small: true,
        }
      : {
          key: "下次运行",
          glyph: "clock",
          value: "无计划",
          sub: "没有工作目录绑定计划",
          tone: "muted",
          small: true,
        };

  const stats: Array<{
    key: string;
    glyph: IconName;
    value: string;
    sub: string;
    tone: string;
    small?: boolean;
  }> = [
    {
      key: "运行中",
      glyph: "play",
      value: String(running.length),
      sub: running.length
        ? running.map((item) => item.name).join("、")
        : `共 ${snapshot.workspaces.length} 个工作目录`,
      tone: running.length ? "run" : "muted",
    },
    {
      key: "今日成功",
      glyph: "check",
      value: String(succeeded),
      sub: `今日共 ${todays.length} 次执行`,
      tone: succeeded ? "ok" : "muted",
    },
    {
      key: "今日失败",
      glyph: "alert",
      value: String(failed.length),
      sub: failed.length ? [...new Set(failed.map((run) => run.workspaceName))].join("、") : "没有失败",
      tone: failed.length ? "fail" : "muted",
    },
    next,
  ];

  return (
    <div className="stats">
      {stats.map((stat) => (
        <article key={stat.key} className={`stat tone-${stat.tone ?? "plain"}`}>
          <div className="stat-key">
            <Icon name={stat.glyph} />
            <span>{stat.key}</span>
          </div>
          <div className={`stat-value${stat.small ? " is-small" : ""}`}>{stat.value}</div>
          <div className="stat-sub" title={stat.sub}>
            {stat.sub}
          </div>
        </article>
      ))}
    </div>
  );
}

function Badge({ status }: { status?: string }) {
  if (!status) {
    return (
      <span className="badge">
        <span className="state-dot" />
        未执行
      </span>
    );
  }
  return (
    <span className={`badge ${status}`}>
      <span className={`state-dot ${status}`} />
      {STATUS_LABELS[status] ?? status}
    </span>
  );
}

function Empty({
  glyph,
  title,
  hint,
  action,
}: {
  glyph: IconName;
  title: string;
  hint: string;
  action?: { label: string; onClick: () => void };
}) {
  return (
    <div className="empty">
      <Icon name={glyph} />
      <div className="empty-title">{title}</div>
      <div className="empty-hint">{hint}</div>
      {action && (
        <button type="button" className="btn btn-sm" onClick={action.onClick}>
          {action.label}
        </button>
      )}
    </div>
  );
}

function WorkspaceList({
  snapshot,
  now,
  onRun,
  onCancel,
  onEdit,
  onGotoConfig,
}: {
  snapshot: Snapshot;
  now: number;
  onRun: (id: string) => void;
  onCancel: (runId: string) => void;
  onEdit: (id: string) => void;
  onGotoConfig: () => void;
}) {
  const items = [...snapshot.workspaces].sort((a, b) => {
    if (a.running !== b.running) {
      return a.running ? -1 : 1;
    }
    if (a.autoScheduled !== b.autoScheduled) {
      return a.autoScheduled ? -1 : 1;
    }
    if (a.nextRun && b.nextRun) {
      return a.nextRun < b.nextRun ? -1 : 1;
    }
    return a.name.localeCompare(b.name, "zh-CN");
  });

  if (!items.length) {
    return (
      <Empty
        glyph="folder"
        title={snapshot.configError ? "配置未加载" : "还没有可运行的目标"}
        hint={
          snapshot.configError
            ? "修好配置文件后这里会列出今日计划。"
            : "去配置页添加自动化任务，并挂上工作目录目标。"
        }
        action={snapshot.configError ? undefined : { label: "打开配置", onClick: onGotoConfig }}
      />
    );
  }

  return (
    <>
      {items.map((item) => (
        <WorkspaceRow
          key={item.id}
          item={item}
          snapshot={snapshot}
          now={now}
          onRun={onRun}
          onCancel={onCancel}
          onEdit={onEdit}
        />
      ))}
    </>
  );
}

function WorkspaceRow({
  item,
  snapshot,
  now,
  onRun,
  onCancel,
  onEdit,
}: {
  item: WorkspaceView;
  snapshot: Snapshot;
  now: number;
  onRun: (id: string) => void;
  onCancel: (runId: string) => void;
  onEdit: (id: string) => void;
}) {
  const status = item.running ? "running" : item.lastRun?.status;
  return (
    <article className="row-card" data-ws={item.id}>
      <div className="ws">
        <span className={`state-dot ws-dot ${status ?? ""}`} />
        <div className="ws-main">
          <div className="ws-line">
            <h3>{item.name}</h3>
            <Badge status={status} />
            {item.autoScheduled ? (
              <span
                className="chip chip-mono"
                title={`任务 ${item.taskName} · cron: ${item.cron}`}
              >
                {item.taskName || item.taskId}
              </span>
            ) : (
              <span className="chip chip-muted">仅手动 · {item.taskName || item.taskId}</span>
            )}
          </div>
          <p className="ws-path" title={item.path}>
            {truncateMiddle(item.path, 78)}
          </p>
          <div className="ws-steps">
            {item.steps.map((label) => {
              const { name, timeout } = splitStepLabel(label);
              return (
                <span key={label} className="chip chip-mono" title={timeout ? `超时 ${timeout}` : undefined}>
                  {name}
                </span>
              );
            })}
          </div>
        </div>
        <div className="ws-facts">
          {item.autoScheduled && (
            <div className="fact">
              <span className="fact-k">下次</span>
              {item.nextRun ? (
                <span
                  className="fact-v"
                  title={`${formatAbsolute(item.nextRun, snapshot.timezone)} · ${relLabel(item.nextRun, now)}`}
                >
                  {dayLabel(item.nextRun, snapshot.timezone)}
                </span>
              ) : (
                <span className="fact-v">cron 无效</span>
              )}
            </div>
          )}
          {item.running ? (
            <div className="fact">
              <span className="fact-k">已运行</span>
              <span className="fact-v">{spanOf(item.lastRun?.startedAt, undefined, now)}</span>
            </div>
          ) : item.lastRun ? (
            <div className="fact">
              <span className="fact-k">最近</span>
              <span
                className="fact-v"
                title={formatAbsolute(item.lastRun.startedAt, snapshot.timezone)}
              >
                {relLabel(item.lastRun.startedAt, now) ||
                  dayLabel(item.lastRun.startedAt, snapshot.timezone)}
              </span>
              <span className="fact-k">
                {TRIGGER_LABELS[item.lastRun.trigger] ?? item.lastRun.trigger}
              </span>
            </div>
          ) : (
            <div className="fact">
              <span className="fact-k">尚无执行记录</span>
            </div>
          )}
        </div>
        <div className="ws-actions">
          {item.running ? (
            <button
              type="button"
              className="btn btn-sm btn-danger"
              onClick={() => item.lastRun && onCancel(item.lastRun.runId)}
            >
              <Icon name="stop" />
              取消
            </button>
          ) : (
            <button type="button" className="btn btn-sm btn-primary" onClick={() => onRun(item.id)}>
              <Icon name="play" />
              运行
            </button>
          )}
          <button
            type="button"
            className="btn btn-icon btn-quiet"
            title="编辑此工作目录的配置"
            aria-label="编辑配置"
            onClick={() => onEdit(item.id)}
          >
            <Icon name="pencil" />
          </button>
        </div>
      </div>
      {item.running && <div className="ws-bar" />}
    </article>
  );
}

function RunList({
  snapshot,
  now,
  runFilter,
  openRuns,
  onToggle,
}: {
  snapshot: Snapshot;
  now: number;
  runFilter: "all" | "failed";
  openRuns: Set<string>;
  onToggle: (runId: string) => void;
}) {
  const runs = (
    runFilter === "failed" ? snapshot.runs.filter((run) => run.status === "failed") : snapshot.runs
  ).slice(0, 20);

  if (!runs.length) {
    return (
      <Empty
        glyph="inbox"
        title={runFilter === "failed" ? "没有失败记录" : "还没有执行记录"}
        hint={runFilter === "failed" ? "切回“全部”看看所有执行。" : "手动运行一次，或等计划触发。"}
      />
    );
  }

  return (
    <>
      {runs.map((run) => (
        <RunRow
          key={run.runId}
          run={run}
          snapshot={snapshot}
          now={now}
          open={openRuns.has(run.runId)}
          onToggle={() => onToggle(run.runId)}
        />
      ))}
    </>
  );
}

function RunRow({
  run,
  snapshot,
  now,
  open,
  onToggle,
}: {
  run: RunRecord;
  snapshot: Snapshot;
  now: number;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <article className={`row-card run-card${open ? " is-open" : ""}`}>
      <button type="button" className="run-head" aria-expanded={open} onClick={onToggle}>
        <span className={`state-dot ${run.status}`} />
        <span className="run-name">{run.workspaceName}</span>
        <span className="run-chips">
          <span className="chip chip-muted">{TRIGGER_LABELS[run.trigger] ?? run.trigger}</span>
          {run.scheduleId !== "manual" && (
            <span className="chip chip-mono">{run.scheduleId}</span>
          )}
        </span>
        <Badge status={run.status} />
        <span
          className="run-when"
          title={formatAbsolute(run.startedAt, snapshot.timezone)}
        >
          {relLabel(run.startedAt, now) || dayLabel(run.startedAt, snapshot.timezone)}
        </span>
        <span className="run-span">{runSpan(run, now)}</span>
        <span className="run-caret">
          <Icon name="chevron" />
        </span>
      </button>
      <div className={`run-detail${open ? "" : " hidden"}`}>
        {!run.steps.length ? (
          <p className="form-note">这次执行没有步骤记录。</p>
        ) : (
          <ol className="steps-list">
            {run.steps.map((step) => {
              const detail = step.error ?? step.outputTail ?? "";
              return (
                <li key={step.index} className="step">
                  <span className="step-idx">{step.index + 1}</span>
                  <span className={`state-dot ${step.status}`} />
                  <span className="step-name">
                    {step.summary || step.type}
                    <span className="chip chip-muted">
                      {STATUS_LABELS[step.status] ?? step.status}
                    </span>
                    {step.exitCode !== undefined &&
                      step.exitCode !== null &&
                      step.exitCode !== 0 && (
                        <span className="chip chip-mono">exit {step.exitCode}</span>
                      )}
                  </span>
                  <span className="step-span">
                    {spanOf(step.startedAt, step.finishedAt, now)}
                  </span>
                  {detail && (
                    <pre className={`step-out${step.error ? " is-error" : ""}`}>
                      {detail.trimEnd()}
                    </pre>
                  )}
                </li>
              );
            })}
          </ol>
        )}
      </div>
    </article>
  );
}


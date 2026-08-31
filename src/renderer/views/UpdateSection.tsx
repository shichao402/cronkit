import { useEffect, useState } from "react";
import {
  formatBytes,
  formatSpeed,
  hopHint,
  isBusy,
  progressPercent,
  type UpdateStatus,
} from "../../core/update/status";
import { Icon } from "../components/Icon";
import { useSnapshot } from "../components/SnapshotContext";
import { useToast } from "../components/Toast";
import { dayLabel } from "../format";

/** 每个阶段一句话，说清「现在是什么情况」，不堆术语。 */
const PHASE_TEXT: Record<UpdateStatus["phase"], string> = {
  idle: "还没有检查过更新",
  checking: "正在检查更新…",
  current: "已是最新版本",
  available: "有新版本可以下载",
  downloading: "正在下载更新…",
  ready: "更新已下载完成，等待安装",
  failed: "检查更新失败",
  manual: "需要手动更新",
};

/** 借用 state-dot 的既有配色，避免为更新再造一套状态色。 */
const PHASE_DOT: Record<UpdateStatus["phase"], string> = {
  idle: "pending",
  checking: "running",
  current: "succeeded",
  available: "queued",
  downloading: "running",
  ready: "succeeded",
  failed: "failed",
  manual: "failed",
};

export function UpdateSection({ timezone }: { timezone: string }) {
  const { api } = useSnapshot();
  const { toast, handle } = useToast();
  const [status, setStatus] = useState<UpdateStatus | null>(null);

  useEffect(() => {
    const unsub = api.onUpdateStatus(setStatus);
    void api.getUpdateStatus().then((next) => {
      if (next) {
        setStatus(next);
      }
    });
    return unsub;
  }, [api]);

  if (!status) {
    return null;
  }

  const busy = isBusy(status);
  const percent = progressPercent(status.progress);
  const speed = formatSpeed(status.progress?.bytesPerSecond ?? 0);
  const hint = hopHint(status.target);

  return (
    <section className="setting-group update">
      <h2>更新</h2>

      <div className="setting-row">
        <div className="setting-text">
          <div className="name">
            <span className={`state-dot ${PHASE_DOT[status.phase]}`} />
            当前版本 {status.currentVersion}
          </div>
          <div className="desc">
            {status.enabled ? PHASE_TEXT[status.phase] : "开发模式下不检查更新"}
            {status.lastCheckedAt && status.enabled
              ? ` · 上次检查 ${dayLabel(status.lastCheckedAt, timezone)}`
              : ""}
          </div>
        </div>
        {status.enabled && (
          <button
            type="button"
            className="btn btn-quiet btn-sm setting-control"
            disabled={busy}
            onClick={() =>
              void handle(async () => {
                const next = await api.checkForUpdate();
                if (next) {
                  setStatus(next);
                  toast(
                    next.phase === "available"
                      ? `发现新版本 ${next.target?.version ?? ""}`
                      : next.phase === "current"
                        ? "已是最新版本"
                        : PHASE_TEXT[next.phase],
                    next.phase === "failed" ? "fail" : "ok",
                  );
                }
              }, "正在检查更新…")
            }
          >
            <Icon name="refresh" />
            检查更新
          </button>
        )}
      </div>

      {status.target && (
        <div className="setting-row">
          <div className="setting-text">
            <div className="name">
              新版本 {status.target.version}
              {status.target.mandatory && <span className="chip chip-warn">必须更新</span>}
              {status.skipped && <span className="chip chip-muted">已跳过</span>}
            </div>
            <div className="desc">
              安装包 {formatBytes(status.target.sizeBytes)}
              {hint ? ` · ${hint}` : ""}
            </div>
            {status.target.releaseNotes && (
              <pre className="update-notes">{status.target.releaseNotes}</pre>
            )}
          </div>
          <div className="setting-control chip-row">
            {status.phase !== "ready" && (
              <button
                type="button"
                className="btn btn-sm"
                disabled={busy}
                onClick={() =>
                  void handle(async () => {
                    const next = await api.downloadUpdate();
                    if (next) {
                      setStatus(next);
                      if (next.phase === "ready") {
                        toast("更新已下载完成");
                      } else if (next.message) {
                        throw new Error(next.message);
                      }
                    }
                  }, "正在下载更新…")
                }
              >
                <Icon name="download" />
                {status.phase === "downloading" ? "下载中…" : "下载"}
              </button>
            )}
            {status.phase === "ready" && (
              <button
                type="button"
                className="btn btn-sm"
                onClick={() =>
                  void handle(async () => {
                    const result = await api.revealUpdate();
                    if (!result.ok) {
                      throw new Error(result.error ?? "无法打开下载目录");
                    }
                    toast("已打开安装包所在目录");
                  }, "正在打开安装包所在目录…")
                }
              >
                <Icon name="folder" />
                打开所在目录
              </button>
            )}
            {!status.target.mandatory && !status.skipped && (
              <button
                type="button"
                className="btn btn-quiet btn-sm"
                disabled={busy}
                onClick={() =>
                  void handle(async () => {
                    const next = await api.skipUpdate();
                    if (next) {
                      setStatus(next);
                      toast("已跳过这个版本");
                    }
                  }, "正在跳过这个版本…")
                }
              >
                跳过
              </button>
            )}
          </div>
        </div>
      )}

      {status.phase === "downloading" && (
        <div className="setting-row">
          <div className="setting-text">
            <div className="name">下载进度 {percent}%</div>
            <div className="desc">
              {formatBytes(status.progress?.receivedBytes ?? 0)} /{" "}
              {formatBytes(status.progress?.totalBytes ?? 0)}
              {speed ? ` · ${speed}` : ""}
            </div>
            <div
              className="update-bar"
              role="progressbar"
              aria-valuenow={percent}
              aria-valuemin={0}
              aria-valuemax={100}
            >
              <span style={{ width: `${percent}%` }} />
            </div>
          </div>
        </div>
      )}

      {status.phase === "ready" && (
        <div className="setting-row">
          <div className="setting-text">
            <div className="name">安装方式</div>
            <div className="desc">
              这一版只把安装包下载并校验完成，需要你手动解压覆盖安装；
              自动替换正在开发中。安装前请确认没有任务正在运行。
            </div>
            {status.downloadedPath && <div className="desc mono">{status.downloadedPath}</div>}
          </div>
        </div>
      )}

      {status.phase === "manual" && (
        <div className="setting-row">
          <div className="setting-text">
            <div className="name">发布方要求手动更新</div>
            <div className="desc">{status.message}</div>
          </div>
          <button
            type="button"
            className="btn btn-sm setting-control"
            onClick={() =>
              void handle(async () => {
                const result = await api.openUpdateManualUrl();
                if (!result.ok) {
                  throw new Error(result.error ?? "无法打开下载页");
                }
                toast("已在浏览器中打开下载页");
              }, "正在打开下载页…")
            }
          >
            <Icon name="external" />
            打开下载页
          </button>
        </div>
      )}

      {status.phase === "failed" && status.message && (
        <div className="setting-row">
          <div className="setting-text">
            <div className="name">失败原因</div>
            <div className="desc">{status.message}</div>
            {status.attempts && status.attempts.length > 0 && (
              // 逐源记录是区分「服务器挂了」和「服务器拒绝我们」的唯一依据。
              <pre className="update-notes">{status.attempts.join("\n")}</pre>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

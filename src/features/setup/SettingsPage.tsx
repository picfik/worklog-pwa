import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { AppConfig } from "@/types/storage";
import { getConfig } from "@/store/configRepository";
import { clearConfigurationAndData } from "@/store/storageRepository";
import { clearPendingUploads } from "@/store/pendingUploadsRepository";
import { clearStoredData } from "@/store/dataRepository";
import { formatDateTime } from "@/utils/date";
import { useAppData } from "@/hooks/useAppData";
import {
  bootstrapSync,
  getRecentSyncLog,
  getSyncStatus,
  refreshSyncStatus,
  type SyncStatus
} from "@/sync/sync";
import type { SyncLogEntry } from "@/types/storage";

function isSyncStatus(value: unknown): value is SyncStatus {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.state === "string" &&
    ["idle", "syncing", "synced", "dirty", "failed", "conflict"].includes(candidate.state) &&
    typeof candidate.localVersion === "number" &&
    typeof candidate.remoteVersion === "number" &&
    typeof candidate.pendingCount === "number" &&
    typeof candidate.lastSyncAt === "string";
}

interface SettingsPageProps {
  onConfigurationCleared: () => void;
}

export function SettingsPage({ onConfigurationCleared }: SettingsPageProps) {
  const navigate = useNavigate();
  const { data, refresh } = useAppData();
  const [config, setConfig] = useState<AppConfig>();
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [syncStatus, setSyncStatus] = useState<SyncStatus>(getSyncStatus());
  const [syncLog, setSyncLog] = useState<SyncLogEntry[]>([]);
  const [syncingNow, setSyncingNow] = useState(false);

  useEffect(() => {
    getConfig()
      .then((storedConfig) => {
        setConfig(storedConfig);
      })
      .catch((loadError: unknown) => {
        setError(loadError instanceof Error ? loadError.message : "读取设置失败");
      });
    void refreshSyncStatus().then(setSyncStatus);
    void getRecentSyncLog().then(setSyncLog);
    function onSyncStatus(event: Event) {
      if (event instanceof CustomEvent && isSyncStatus(event.detail)) {
        setSyncStatus(event.detail);
        setSyncingNow(event.detail.state === "syncing");
        void getRecentSyncLog().then(setSyncLog);
      }
    }
    window.addEventListener("worklog:sync-status", onSyncStatus);
    return () => window.removeEventListener("worklog:sync-status", onSyncStatus);
  }, []);

  async function handleClearConfiguration() {
    if (!window.confirm("将清除本机配置、数据和 OSS 密钥，且无法撤销。是否继续？")) {
      return;
    }
    try {
      await clearConfigurationAndData();
      onConfigurationCleared();
      navigate("/setup", { replace: true });
    } catch (clearError: unknown) {
      setError(clearError instanceof Error ? clearError.message : "清除本地配置失败");
    }
  }

  async function handleResetAndPull() {
    if (!window.confirm("将删除本地数据及未上传附件，再从 OSS 重新拉取。是否继续？")) {
      return;
    }
    setError("");
    setNotice("");
    setSyncingNow(true);
    try {
      await Promise.all([clearStoredData(), clearPendingUploads()]);
      try {
        const cacheKeys: string[] = [];
        for (let index = 0; index < localStorage.length; index += 1) {
          const key = localStorage.key(index);
          if (key && (key.startsWith("audit-") || key.startsWith("monthlyReport-") || key === "lastWeeklyReview")) {
            cacheKeys.push(key);
          }
        }
        for (const key of cacheKeys) localStorage.removeItem(key);
      } catch (storageError: unknown) {
        throw new Error(
          storageError instanceof Error
            ? `清理本地巡检/回顾缓存失败：${storageError.message}`
            : "清理本地巡检/回顾缓存失败"
        );
      }
      await bootstrapSync();
      await refresh();
      setSyncStatus(getSyncStatus());
      setNotice("已从云端重新拉取本地数据");
    } catch (syncError: unknown) {
      setError(syncError instanceof Error ? syncError.message : "重新拉取失败");
    } finally {
      setSyncingNow(false);
    }
  }

  function requestImmediateSync() {
    setSyncingNow(true);
    setError("");
    window.dispatchEvent(new Event("worklog:sync-request"));
  }

  if (!config && !error) {
    return <p className="text-sm text-slate-500">正在读取设置…</p>;
  }

  return (
    <section className="mx-auto max-w-3xl rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-8">
      <h1 className="text-xl font-semibold text-slate-900">设置</h1>
      {config && (
        <dl className="mt-6 grid gap-4 sm:grid-cols-2">
          <div>
            <dt className="text-xs text-slate-500">设备名称</dt>
            <dd className="mt-1 text-sm font-medium">{config.deviceName}</dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500">deviceId</dt>
            <dd className="mt-1 break-all font-mono text-xs">{config.deviceId}</dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500">OSS Bucket</dt>
            <dd className="mt-1 text-sm">{config.oss.bucket}</dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500">OSS Region</dt>
            <dd className="mt-1 text-sm">{config.oss.region}</dd>
          </div>
          <div className="sm:col-span-2">
            <dt className="text-xs text-slate-500">OSS Endpoint</dt>
            <dd className="mt-1 break-all text-sm">{config.oss.endpoint}</dd>
          </div>
          <div className="sm:col-span-2">
            <dt className="text-xs text-slate-500">OSS AccessKeyId</dt>
            <dd className="mt-1 font-mono text-xs">
              由 GitHub Actions 构建时注入（secrets：OSS_ACCESS_KEY_ID）
            </dd>
          </div>
        </dl>
      )}
      {error && <p className="mt-4 text-sm text-red-700" role="alert">{error}</p>}
      {notice && <p className="mt-4 text-sm text-slate-600" role="status">{notice}</p>}
      <section className="mt-6 border-t border-slate-100 pt-5">
        <h2 className="text-sm font-semibold text-slate-800">设备列表</h2>
        <p className="mt-1 text-xs text-slate-500">记录曾登记并参与留痕的设备及最近活动时间。</p>
        {(data?.devices ?? []).length > 0 ? (
          <ul className="mt-3 divide-y divide-slate-100 rounded-lg border border-slate-100 px-3">
            {[...(data?.devices ?? [])]
              .sort((left, right) => Date.parse(right.lastSeenAt) - Date.parse(left.lastSeenAt))
              .map((device) => (
                <li key={device.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                  <div>
                    <p className="text-sm font-medium text-slate-800">{device.name}</p>
                    <p className="mt-1 break-all font-mono text-[11px] text-slate-400">{device.id}</p>
                  </div>
                  <time className="text-xs text-slate-500">
                    最近活动：{device.lastSeenAt ? formatDateTime(new Date(device.lastSeenAt)) : "暂无"}
                  </time>
                </li>
              ))}
          </ul>
        ) : (
          <p className="mt-3 text-xs text-slate-400">暂无设备记录</p>
        )}
      </section>
      <section className="mt-6 border-t border-slate-100 pt-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-slate-800">同步</h2>
            <p className="mt-1 text-xs text-slate-500">
              本地版本 {data?.manifest.version ?? syncStatus.localVersion} · 远端版本 {syncStatus.remoteVersion} ·
              {" "}{data?.dirty ? "有未同步修改" : "本地干净"}
            </p>
            <p className="mt-1 text-xs text-slate-500">
              上次同步：{syncStatus.lastSyncAt ? formatDateTime(new Date(syncStatus.lastSyncAt)) : "暂无"}
            </p>
          </div>
          <button
            type="button"
            disabled={syncingNow}
            onClick={requestImmediateSync}
            className="rounded-lg bg-navy px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {syncingNow ? "正在同步…" : "立即同步"}
          </button>
        </div>
        {syncStatus.error && (
          <p className="mt-3 text-xs text-red-700" role="alert">{syncStatus.error}</p>
        )}
        <h3 className="mt-5 text-xs font-semibold text-slate-700">最近 20 条同步记录</h3>
        {syncLog.length > 0 ? (
          <ol className="mt-2 max-h-56 divide-y divide-slate-100 overflow-y-auto">
            {syncLog.map((entry, index) => (
              <li key={`${entry.at}-${entry.action}-${index}`} className="py-2 text-xs">
                <span className={entry.success ? "text-slate-700" : "text-red-700"}>
                  {entry.success ? "成功" : "失败"} · {entry.action}
                  {entry.message ? ` · ${entry.message}` : ""}
                </span>
                <time className="ml-2 text-slate-400">{formatDateTime(new Date(entry.at))}</time>
              </li>
            ))}
          </ol>
        ) : (
          <p className="mt-2 text-xs text-slate-400">暂无同步记录</p>
        )}
      </section>
      <section className="mt-6 border-t border-slate-100 pt-5">
        <h2 className="text-sm font-semibold text-slate-800">OSS AccessKey</h2>
        <p className="mt-1 text-xs leading-5 text-slate-500">
          密钥由 GitHub Actions 构建时自动注入（secrets：OSS_ACCESS_KEY_ID / OSS_ACCESS_KEY_SECRET），
          本页无需也无法修改。如需更换密钥，请在仓库 Actions 设置中更新后重新部署。
        </p>
      </section>
      <div className="mt-8 grid gap-3 border-t border-slate-100 pt-6 sm:grid-cols-2">
        <button
          type="button"
          disabled={syncingNow}
          onClick={() => void handleResetAndPull()}
          className="rounded-lg border border-slate-300 px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
        >
          清空本地缓存并从云端恢复
        </button>
        <button
          type="button"
          onClick={handleClearConfiguration}
          className="rounded-lg border border-red-200 px-4 py-2.5 text-sm font-medium text-red-700 hover:bg-red-50"
        >
          锁定清除配置
        </button>
      </div>
    </section>
  );
}

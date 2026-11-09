import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { AppConfig, StoredPresignedUrl } from "@/types/storage";
import { getConfig } from "@/store/configRepository";
import { getPresignPool } from "@/store/presignPoolRepository";
import { addPresignUrls } from "@/store/presignPoolRepository";
import { clearConfigurationAndData } from "@/store/storageRepository";
import { clearPendingUploads } from "@/store/pendingUploadsRepository";
import { clearStoredData } from "@/store/dataRepository";
import { formatDateTime } from "@/utils/date";
import { parsePresignedUrls } from "@/oss/presignValidation";
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
  const [presignUrls, setPresignUrls] = useState<StoredPresignedUrl[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [presignJson, setPresignJson] = useState("");
  const [savingUrls, setSavingUrls] = useState(false);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>(getSyncStatus());
  const [syncLog, setSyncLog] = useState<SyncLogEntry[]>([]);
  const [syncingNow, setSyncingNow] = useState(false);

  useEffect(() => {
    Promise.all([getConfig(), getPresignPool()])
      .then(([storedConfig, urls]) => {
        setConfig(storedConfig);
        setPresignUrls(urls);
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

  const validUrls = presignUrls.filter((entry) => Date.parse(entry.expiresAt) > Date.now());
  const nearestExpiry = validUrls
    .map((entry) => Date.parse(entry.expiresAt))
    .sort((left, right) => left - right)[0];

  async function handleClearConfiguration() {
    if (!window.confirm("将清除本机配置、数据和预签名 URL，且无法撤销。是否继续？")) {
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

  async function handleAddPresignedUrls() {
    setError("");
    setNotice("");
    setSavingUrls(true);
    try {
      const urls = parsePresignedUrls(presignJson);
      if (urls.length === 0) {
        throw new Error("请粘贴至少一个预签名 URL");
      }
      await addPresignUrls(urls);
      const refreshed = await getPresignPool();
      setPresignUrls(refreshed);
      setPresignJson("");
      setNotice(`已添加 ${urls.length} 条预签名 URL`);
    } catch (saveError: unknown) {
      setError(saveError instanceof Error ? saveError.message : "添加预签名 URL 失败");
    } finally {
      setSavingUrls(false);
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
          <div>
            <dt className="text-xs text-slate-500">预签名 URL 池剩余</dt>
            <dd className="mt-1 text-sm">{validUrls.length} 条</dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500">最近过期时间</dt>
            <dd className="mt-1 text-sm">
              {nearestExpiry ? formatDateTime(new Date(nearestExpiry)) : "暂无有效 URL"}
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
        <h2 className="text-sm font-semibold text-slate-800">添加预签名 URL</h2>
        <p className="mt-1 text-xs leading-5 text-slate-500">
          将本机签名脚本输出的 PUT/GET URL JSON 粘贴到这里；只会存入此浏览器，不要粘贴 AccessKey。
          脚本生成的 PUT URL 会包含签名所需的 Content-Type。
        </p>
        <textarea
          rows={5}
          value={presignJson}
          onChange={(event) => setPresignJson(event.target.value)}
          spellCheck={false}
          placeholder={'[{"type":"put","url":"https://...","key":"worklog/example","expiresAt":"2026-11-09T12:00:00Z"}]'}
          className="mt-3 w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-xs outline-none focus:border-blue-600"
        />
        <button
          type="button"
          disabled={savingUrls}
          onClick={() => void handleAddPresignedUrls()}
          className="mt-2 rounded-lg bg-navy px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {savingUrls ? "正在保存…" : "添加到本机 URL 池"}
        </button>
        <details className="mt-4 rounded-lg bg-slate-50 p-3">
          <summary className="cursor-pointer text-sm font-medium text-slate-700">
            重新生成预签名池提示
          </summary>
          <div className="mt-2 space-y-2 text-xs leading-5 text-slate-600">
            <p>在可信任的本机终端设置 OSS 环境变量后运行 <code className="rounded bg-white px-1">npm run presign</code>，不要把密钥填入本页或提交到仓库。</p>
            <p>将脚本输出 JSON 粘贴到上方文本框并添加到本机 URL 池。生成新池前，旧的未使用 URL 仍会留在本机，必要时可锁定清除配置后重新设置。</p>
            <p>AccessKey 只授予目标 bucket 所需的 PutObject/GetObject 权限，预签名 URL 到期后需重新生成。</p>
          </div>
        </details>
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

import { BrowserRouter, Link, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { Suspense, lazy, useEffect, useState } from "react";
import type { AppConfig } from "@/types/storage";
import { getConfig } from "@/store/configRepository";
import { hasStoredData, loadData } from "@/store/dataRepository";
import { AppShell } from "@/components/AppShell";
import { SetupPage } from "@/features/setup/SetupPage";
import { SettingsPage } from "@/features/setup/SettingsPage";
import { TaskWorkspace } from "@/features/tasks/TaskWorkspace";
import { TaskDetailPage } from "@/features/tasks/TaskDetailPage";
import { AttachmentLibraryPage } from "@/features/attachments/AttachmentLibraryPage";
import { AuditPage } from "@/features/audit/AuditPage";
import { AboutPage } from "@/features/setup/AboutPage";
import { bootstrapSync, synchronize } from "@/sync/sync";

const SearchPage = lazy(() =>
  import("@/features/search/SearchPage").then((module) => ({ default: module.SearchPage }))
);
const TimelinePage = lazy(() =>
  import("@/features/timeline/TimelinePage").then((module) => ({ default: module.TimelinePage }))
);

function BootGate() {
  const [config, setConfig] = useState<AppConfig | null | undefined>(undefined);
  const [checkingConfig, setCheckingConfig] = useState(true);
  const [booting, setBooting] = useState(false);
  const [loadError, setLoadError] = useState<string>();
  const [localDataMissing, setLocalDataMissing] = useState(false);
  const [recoveredLocalData, setRecoveredLocalData] = useState(false);
  const location = useLocation();

  useEffect(() => {
    let active = true;
    getConfig()
      .then((storedConfig) => {
        if (active) setConfig(storedConfig?.deviceId ? storedConfig : null);
      })
      .catch((error: unknown) => {
        if (active) setLoadError(error instanceof Error ? error.message : "读取本地配置失败");
      })
      .finally(() => {
        if (active) setCheckingConfig(false);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!config) return;
    let active = true;
    async function initializeWorkspace() {
      setBooting(true);
      setLoadError(undefined);
      try {
        const hasLocalRecord = await hasStoredData();
        if (!hasLocalRecord && active) {
          setLocalDataMissing(true);
        }
        const data = await loadData();
        const hasLocalContent =
          data.tasks.length > 0 ||
          data.attachments.length > 0 ||
          data.statusHistory.length > 0 ||
          Object.keys(data.archives).length > 0;
        const requiresInitialPull =
          !hasLocalRecord ||
          (!data.dirty &&
            data.manifest.version === 0 &&
            data.lastRemoteVersion === 0 &&
            !hasLocalContent);
        if (requiresInitialPull) {
          const result = await bootstrapSync();
          if (!hasLocalRecord && active) setRecoveredLocalData(result.recovered);
        } else {
          void synchronize();
        }
      } catch (error: unknown) {
        if (active) {
          setLoadError(
            error instanceof Error ? error.message : "初始化同步失败"
          );
        }
      } finally {
        if (active) setBooting(false);
      }
    }
    void initializeWorkspace();
    return () => {
      active = false;
    };
  }, [config]);

  if (checkingConfig) {
    return <main className="p-6 text-sm text-slate-500">正在读取本地配置…</main>;
  }
  if (loadError && !config) {
    return (
      <main className="mx-auto max-w-xl p-6 text-red-700" role="alert">
        本地配置读取失败：{loadError}
      </main>
    );
  }
  if (config && location.pathname !== "/settings" && (booting || loadError)) {
    return (
      <main className="mx-auto flex min-h-screen max-w-xl flex-col justify-center gap-4 p-6">
        {booting ? (
          <p className="text-sm text-slate-600" role="status">
            {localDataMissing
              ? "本地数据已丢失，将从云端恢复"
              : "正在从云端检查并恢复工作数据…"}
          </p>
        ) : (
          <>
            <p className="text-sm text-red-700" role="alert">
              首次同步失败：{loadError}
            </p>
            <button
              type="button"
              onClick={() => {
                setLoadError(undefined);
                setConfig({ ...config });
              }}
              className="rounded-lg bg-navy px-4 py-2 text-sm font-medium text-white"
            >
              重试首次同步
            </button>
            <Link to="/settings" className="text-sm text-blue-700 underline">
              前往设置检查预签名 URL
            </Link>
          </>
        )}
      </main>
    );
  }
  if (!config && location.pathname !== "/setup") {
    return <Navigate to="/setup" replace />;
  }
  if (config && location.pathname === "/setup") {
    return <Navigate to="/" replace />;
  }

  return (
    <Routes>
      <Route
        path="/setup"
        element={<SetupPage onConfigured={(savedConfig) => setConfig(savedConfig)} />}
      />
      {config && (
        <Route
          element={
            <AppShell
              initialToast={
                recoveredLocalData
                  ? "本地数据已丢失，已从云端恢复"
                  : ""
              }
            />
          }
        >
          <Route
            path="/"
            element={<TaskWorkspace />}
          />
          <Route path="/task/:id" element={<TaskDetailPage />} />
          <Route
            path="/search"
            element={
              <Suspense fallback={<p className="text-sm text-slate-500">正在加载搜索…</p>}>
                <SearchPage />
              </Suspense>
            }
          />
          <Route
            path="/timeline"
            element={
              <Suspense fallback={<p className="text-sm text-slate-500">正在加载时间线…</p>}>
                <TimelinePage />
              </Suspense>
            }
          />
          <Route path="/attachments" element={<AttachmentLibraryPage />} />
          <Route path="/audit" element={<AuditPage />} />
          <Route
            path="/settings"
            element={<SettingsPage onConfigurationCleared={() => setConfig(null)} />}
          />
          <Route path="/about" element={<AboutPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      )}
      {!config && <Route path="*" element={<Navigate to="/setup" replace />} />}
    </Routes>
  );
}

export function App() {
  const basename = import.meta.env.BASE_URL.replace(/\/$/, "") || "/";
  return (
    <BrowserRouter
      basename={basename}
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      <BootGate />
    </BrowserRouter>
  );
}

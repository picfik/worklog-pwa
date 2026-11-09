import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useEffect, useState, type FormEvent } from "react";
import {
  getSyncStatus,
  refreshSyncStatus,
  synchronize,
  type ConflictChoice,
  type SyncStatus
} from "@/sync/sync";
import { useAppData } from "@/hooks/useAppData";
import { useDailyAudit } from "@/hooks/useDailyAudit";
import { getIsoWeekKey } from "@/reports/periods";
import { WeeklyReviewPage } from "@/features/review/WeeklyReviewPage";
import { MonthlyReportBanner } from "@/features/reports/MonthlyReportBanner";

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

const links = [
  { to: "/", label: "工作台", end: true },
  { to: "/search", label: "搜索" },
  { to: "/timeline", label: "时间线" },
  { to: "/attachments", label: "附件" },
  { to: "/audit", label: "巡检" },
  { to: "/settings", label: "设置" },
  { to: "/about", label: "关于" }
];

export function AppShell({ initialToast = "" }: { initialToast?: string }) {
  const location = useLocation();
  const navigate = useNavigate();
  const { data } = useAppData();
  const { findings: auditFindings, error: auditError } = useDailyAudit(data);
  const [toast, setToast] = useState(initialToast);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>(getSyncStatus());
  const [showConflict, setShowConflict] = useState(
    getSyncStatus().state === "conflict"
  );
  const [globalSearch, setGlobalSearch] = useState("");
  const [weeklyReviewWeek, setWeeklyReviewWeek] = useState<string>();
  const [weeklyReviewError, setWeeklyReviewError] = useState("");
  const criticalTaskIds = new Set(
    (auditFindings ?? [])
      .filter((finding) => finding.level === "red" && finding.taskId)
      .map((finding) => finding.taskId)
  );
  const activeCriticalCount = data?.tasks.filter((task) => criticalTaskIds.has(task.id)).length ?? 0;
  const unclassifiedCount = data?.attachments.filter((attachment) => attachment.role === "other").length ?? 0;

  useEffect(() => {
    function onGlobalSearchShortcut(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        navigate("/search");
        window.setTimeout(() => document.getElementById("global-search")?.focus(), 0);
      }
    }
    window.addEventListener("keydown", onGlobalSearchShortcut);
    return () => window.removeEventListener("keydown", onGlobalSearchShortcut);
  }, [navigate]);

  useEffect(() => {
    if (location.pathname !== "/" || !data) return;
    const now = new Date();
    if (now.getDay() !== 1) {
      setWeeklyReviewWeek(undefined);
      return;
    }
    const week = getIsoWeekKey(now);
    try {
      if (localStorage.getItem("lastWeeklyReview") !== week) {
        setWeeklyReviewWeek(week);
      } else {
        setWeeklyReviewWeek(undefined);
      }
      setWeeklyReviewError("");
    } catch (error: unknown) {
      setWeeklyReviewError(error instanceof Error ? error.message : "无法读取周回顾记录");
      setWeeklyReviewWeek(week);
    }
  }, [data, location.pathname]);

  function enterWorkspace() {
    if (!weeklyReviewWeek) return;
    try {
      localStorage.setItem("lastWeeklyReview", weeklyReviewWeek);
      setWeeklyReviewWeek(undefined);
      setWeeklyReviewError("");
    } catch (error: unknown) {
      setWeeklyReviewError(error instanceof Error ? error.message : "保存周回顾状态失败");
    }
  }

  function submitGlobalSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const query = globalSearch.trim();
    navigate(query ? `/search?q=${encodeURIComponent(query)}` : "/search");
  }

  useEffect(() => {
    let timer: number | undefined;
    let active = true;
    const requestSync = (choice?: ConflictChoice) => {
      void synchronize(choice).then((outcome) => {
        if (active && outcome.result === "conflict") {
          setShowConflict(true);
        }
      });
    };
    function onToast(event: Event) {
      if (event instanceof CustomEvent && typeof event.detail === "string") {
        setToast(event.detail);
        window.setTimeout(() => setToast(""), 3000);
      }
    }
    function onSyncStatus(event: Event) {
      if (event instanceof CustomEvent && isSyncStatus(event.detail)) {
        setSyncStatus(event.detail);
        setShowConflict(event.detail.state === "conflict");
      }
    }
    function onDataChanged() {
      if (timer !== undefined) window.clearTimeout(timer);
      const delay = window.matchMedia("(max-width: 639px)").matches ? 1200 : 400;
      timer = window.setTimeout(() => {
        void refreshSyncStatus().then((status) => {
          if (navigator.onLine && status.pendingCount > 0) requestSync();
        });
      }, delay);
    }
    function onSyncRequest() {
      requestSync();
    }
    function onOnline() {
      requestSync();
    }
    function onVisibilityChange() {
      if (document.visibilityState === "visible") requestSync();
    }
    function pollRemote() {
      if (document.visibilityState === "visible" && navigator.onLine) requestSync();
    }
    const pollTimer = window.setInterval(pollRemote, 30000);
    window.addEventListener("worklog:toast", onToast);
    window.addEventListener("worklog:sync-status", onSyncStatus);
    window.addEventListener("worklog:data-changed", onDataChanged);
    window.addEventListener("worklog:sync-request", onSyncRequest);
    window.addEventListener("online", onOnline);
    document.addEventListener("visibilitychange", onVisibilityChange);
    void refreshSyncStatus();
    return () => {
      active = false;
      if (timer !== undefined) window.clearTimeout(timer);
      window.clearInterval(pollTimer);
      window.removeEventListener("worklog:toast", onToast);
      window.removeEventListener("worklog:sync-status", onSyncStatus);
      window.removeEventListener("worklog:data-changed", onDataChanged);
      window.removeEventListener("worklog:sync-request", onSyncRequest);
      window.removeEventListener("online", onOnline);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, []);

  function syncLabel(): string {
    if (syncStatus.state === "syncing") return "正在同步…";
    if (syncStatus.state === "failed") return "同步失败，点重试";
    if (syncStatus.state === "conflict") return "发现同步冲突";
    if (syncStatus.state === "dirty" || syncStatus.pendingCount > 0) {
      return `${syncStatus.pendingCount} 项待同步`;
    }
    return `已同步 版本 ${syncStatus.localVersion}`;
  }

  function resolveConflict(choice: ConflictChoice) {
    setShowConflict(false);
    void synchronize(choice).then((outcome) => {
      if (outcome.status.state === "failed") {
        setToast(outcome.status.error ?? "同步失败");
      }
    });
  }

  return (
    <div className="min-h-screen bg-canvas">
      {toast && (
        <div
          className="fixed bottom-20 left-1/2 z-50 -translate-x-1/2 rounded-full bg-slate-900 px-4 py-2 text-sm text-white shadow-lg"
          role="status"
        >
          {toast}
        </div>
      )}
      <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-[1440px] items-center gap-3 px-4 sm:px-6">
          <div className="font-semibold tracking-wide text-navy">工作留痕</div>
          <form onSubmit={submitGlobalSearch} className="mx-auto hidden w-full max-w-xl sm:block">
            <label className="sr-only" htmlFor="global-search">全局搜索</label>
            <input
              id="global-search"
              type="search"
              value={globalSearch}
              onChange={(event) => setGlobalSearch(event.target.value)}
              placeholder="搜索任务、依据或附件 · Ctrl/Cmd+K"
              className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs outline-none focus:border-blue-500 focus:bg-white"
            />
          </form>
          <button
            type="button"
            onClick={() => navigate("/search")}
            className="ml-auto rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs text-slate-600 sm:hidden"
          >
            搜索
          </button>
          <button
            type="button"
            onClick={() => window.dispatchEvent(new Event("worklog:sync-request"))}
            className={`flex items-center gap-2 text-xs ${
              syncStatus.state === "failed" || syncStatus.state === "conflict"
                ? "font-medium text-red-700"
                : syncStatus.state === "dirty"
                  ? "font-medium text-amber-700"
                  : "text-slate-500"
            }`}
            aria-label="立即同步或重试"
            title={syncStatus.error}
          >
            <span className={`h-2 w-2 rounded-full ${
              syncStatus.state === "failed" || syncStatus.state === "conflict"
                ? "bg-red-500"
                : syncStatus.state === "dirty"
                  ? "bg-amber-500"
                  : syncStatus.state === "synced"
                    ? "bg-green-500"
                    : "bg-slate-400"
            }`} />
            {syncLabel()}
          </button>
        </div>
      </header>
      <div className="mx-auto grid min-h-[calc(100vh-3.5rem)] max-w-[1440px] grid-cols-1 lg:grid-cols-[240px_minmax(0,1fr)]">
        <aside className="hidden border-r border-slate-200 bg-white p-4 lg:block">
          <nav className="space-y-1" aria-label="主导航">
            {links.map((link) => (
              <NavLink
                key={link.to}
                to={link.to}
                end={link.end}
                className={({ isActive }) =>
                  `block rounded-lg px-3 py-2 text-sm ${
                    isActive
                      ? "bg-blue-50 font-medium text-navy"
                      : "text-slate-600 hover:bg-slate-50"
                  }`
                }
              >
                {link.label}
              </NavLink>
            ))}
          </nav>
          <div className="mt-8 rounded-xl border border-dashed border-slate-300 p-4 text-xs leading-5 text-slate-400">
            任务列表区域将在后续阶段启用
          </div>
        </aside>
        <main className="min-w-0 p-4 sm:p-6 lg:p-8">
          {location.pathname !== "/" && !location.pathname.startsWith("/task/") && (
            <nav className="mb-4 flex gap-2 overflow-x-auto lg:hidden" aria-label="主导航">
              {links.map((link) => (
                <NavLink
                  key={link.to}
                  to={link.to}
                  end={link.end}
                  className={({ isActive }) =>
                    `shrink-0 rounded-full px-3 py-1.5 text-xs ${
                      isActive ? "bg-navy text-white" : "bg-white text-slate-600"
                    }`
                  }
                >
                  {link.label}
                </NavLink>
              ))}
            </nav>
          )}
          {weeklyReviewError && (
            <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-800" role="alert">
              周回顾状态未能保存：{weeklyReviewError}
            </p>
          )}
          <MonthlyReportBanner
            data={data}
            visible={!weeklyReviewWeek || location.pathname !== "/"}
          />
          {weeklyReviewWeek && location.pathname === "/" && data ? (
            auditFindings ? (
              <WeeklyReviewPage data={data} findings={auditFindings} onEnter={enterWorkspace} />
            ) : (
              <p className="rounded-xl bg-white p-5 text-sm text-slate-500">正在准备上周回顾…</p>
            )
          ) : (
          <>
          {auditError && (
            <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900" role="status">
              巡检结果暂时不可用：{auditError}
            </p>
          )}
          {activeCriticalCount > 0 && (
            <Link
              to="/audit"
              className="mb-3 block rounded-lg bg-red-50 px-3 py-2 text-sm font-medium text-red-800"
            >
              🔴 {activeCriticalCount} 个不合规任务 · 点击查看巡检
            </Link>
          )}
          {unclassifiedCount > 0 && (
            <Link
              to="/audit"
              className="mb-4 block rounded-lg bg-amber-50 px-3 py-2 text-sm font-medium text-amber-900"
            >
              🟡 {unclassifiedCount} 个附件未归类 · 点击前往处理
            </Link>
          )}
          <Outlet />
          </>
          )}
        </main>
      </div>
      {showConflict && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4">
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="sync-conflict-title"
            className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl"
          >
            <h2 id="sync-conflict-title" className="text-lg font-semibold text-slate-900">
              检测到同步冲突
            </h2>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              本地版本 {syncStatus.localVersion}，远端版本 {syncStatus.remoteVersion}。系统不合并多端数据，请选择保留一方。
            </p>
            <div className="mt-5 grid gap-2">
              <button
                type="button"
                onClick={() => resolveConflict("overwrite-remote")}
                className="rounded-lg bg-navy px-4 py-2.5 text-sm font-medium text-white"
              >
                用本地覆盖远端
              </button>
              <button
                type="button"
                onClick={() => resolveConflict("use-remote")}
                className="rounded-lg border border-slate-300 px-4 py-2.5 text-sm font-medium text-slate-700"
              >
                放弃本地用远端
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { Task, TaskStatus } from "@/types/task";
import { QuickCapture } from "@/features/tasks/QuickCapture";
import { TaskEditor } from "@/features/tasks/TaskEditor";
import { TaskListPanel } from "@/features/tasks/TaskListPanel";
import { useAppData } from "@/hooks/useAppData";
import { createTask, changeStatus } from "@/store/tasks";
import { showToast } from "@/utils/toast";
import { formatDate } from "@/utils/date";
import { taskStatusLabels } from "@/features/tasks/taskLabels";
import { useDailyAudit } from "@/hooks/useDailyAudit";

function localDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function sortByDeadline(left: Task, right: Task): number {
  return (left.deadline ?? "9999-12-31").localeCompare(right.deadline ?? "9999-12-31");
}

export function TaskWorkspace() {
  const { data, error } = useAppData();
  const navigate = useNavigate();
  const [selectedId, setSelectedId] = useState<string>();
  const [quickCaptureMode, setQuickCaptureMode] = useState<"sheet" | "overlay">();
  const [mobileView, setMobileView] = useState<"today" | "todos">("today");
  const [collapsedList, setCollapsedList] = useState(false);
  const tasks = data?.tasks ?? [];
  const { findings: auditFindings } = useDailyAudit(data);
  const criticalTaskIds = useMemo(
    () => new Set((auditFindings ?? []).flatMap((finding) =>
      finding.level === "red" && finding.taskId ? [finding.taskId] : []
    )),
    [auditFindings]
  );
  const selectedTask = tasks.find((task) => task.id === selectedId);

  useEffect(() => {
    if (!selectedId && tasks[0]) {
      setSelectedId(tasks[0].id);
    } else if (selectedId && !tasks.some((task) => task.id === selectedId)) {
      setSelectedId(tasks[0]?.id);
    }
  }, [selectedId, tasks]);

  const createAndSelect = useCallback(async () => {
    try {
      const task = await createTask({ title: "新任务" });
      setSelectedId(task.id);
      if (window.matchMedia("(max-width: 639px)").matches) {
        navigate(`/task/${task.id}`);
      } else {
        window.setTimeout(() => document.getElementById(`task-title-${task.id}`)?.focus(), 0);
      }
    } catch (createError: unknown) {
      showToast(createError instanceof Error ? createError.message : "创建任务失败");
    }
  }, [navigate]);

  const onSelect = useCallback((task: Task) => {
    if (window.matchMedia("(max-width: 639px)").matches) {
      navigate(`/task/${task.id}`);
    } else {
      setSelectedId(task.id);
    }
  }, [navigate]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const command = event.metaKey || event.ctrlKey;
      if (!command || event.altKey || quickCaptureMode) return;
      const key = event.key.toLowerCase();
      if (key === "n" && event.shiftKey) {
        event.preventDefault();
        setQuickCaptureMode(window.matchMedia("(max-width: 639px)").matches ? "sheet" : "overlay");
      } else if (key === "n") {
        event.preventDefault();
        void createAndSelect();
      } else if (key === "s") {
        event.preventDefault();
        window.dispatchEvent(new Event("worklog:sync-request"));
      } else if (key === "b") {
        event.preventDefault();
        setCollapsedList((value) => !value);
      } else if (key === "enter" && selectedTask) {
        event.preventDefault();
        const next: Partial<Record<TaskStatus, TaskStatus>> = {
          todo: "doing",
          doing: "done"
        };
        const nextStatus = next[selectedTask.status];
        if (nextStatus) {
          void changeStatus(selectedTask.id, nextStatus)
            .then(() => showToast(`状态已更新：${taskStatusLabels[nextStatus]}`))
            .catch((statusError: unknown) =>
              showToast(statusError instanceof Error ? statusError.message : "状态更新失败")
            );
        } else {
          showToast("已完成任务可归档");
        }
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [createAndSelect, quickCaptureMode, selectedTask]);

  const openTasks = useMemo(
    () => tasks.filter((task) => task.status === "todo" || task.status === "doing"),
    [tasks]
  );
  const todayKey = localDateKey(new Date());
  const todayTasks = useMemo(
    () =>
      openTasks
        .filter((task) => task.deadline !== null && task.deadline.slice(0, 10) <= todayKey)
        .sort((left, right) =>
          Number(criticalTaskIds.has(right.id)) - Number(criticalTaskIds.has(left.id)) ||
          sortByDeadline(left, right)
        ),
    [openTasks, todayKey, criticalTaskIds]
  );

  if (error) {
    return <p className="rounded-xl bg-red-50 p-4 text-sm text-red-700" role="alert">{error}</p>;
  }
  if (!data) {
    return <p className="text-sm text-slate-500">正在读取任务…</p>;
  }

  const mobileTasks = mobileView === "today"
    ? todayTasks
    : [...openTasks].sort((left, right) =>
        Number(criticalTaskIds.has(right.id)) - Number(criticalTaskIds.has(left.id)) ||
        sortByDeadline(left, right)
      );
  return (
    <>
      <div className="min-[640px]:hidden">
        <section className="space-y-4">
          <label className="block">
            <span className="sr-only">搜索任务</span>
            <input
              id="workspace-search-mobile"
              type="search"
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  navigate(`/search?q=${encodeURIComponent(event.currentTarget.value)}`);
                }
              }}
              placeholder="搜索任务、文号或附件"
              className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm shadow-sm outline-none focus:border-blue-600"
            />
          </label>
          <div className="grid grid-cols-3 gap-2">
            <button
              type="button"
              onClick={() => setQuickCaptureMode("sheet")}
              className="min-h-20 rounded-xl bg-navy px-2 py-3 text-sm font-semibold text-white"
            >
              快速记一条
            </button>
            <button
              type="button"
              onClick={() => setMobileView((view) => view === "todos" ? "today" : "todos")}
              className={`min-h-20 rounded-xl px-2 py-3 text-sm font-semibold ${
                mobileView === "todos" ? "bg-blue-100 text-navy" : "bg-white text-slate-700 shadow-sm"
              }`}
            >
              待办
            </button>
            <button
              type="button"
              disabled
              title="附件上传将在 P2 接入"
              className="min-h-20 rounded-xl bg-white px-2 py-3 text-sm font-semibold text-slate-400 shadow-sm disabled:cursor-not-allowed"
            >
              传附件
            </button>
          </div>
          <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex items-start justify-between gap-2">
              <div>
                <h1 className="font-semibold text-slate-900">
                  {mobileView === "today" ? "今日待办" : "待办任务"}
                </h1>
                <p className="mt-1 text-xs text-slate-500">{formatDate(new Date())}</p>
              </div>
              <span className="text-xs text-slate-400">{mobileTasks.length} 条</span>
            </div>
            <ul className="mt-3 divide-y divide-slate-100">
              {mobileTasks.map((task) => {
                const overdue = Boolean(task.deadline && task.deadline.slice(0, 10) < todayKey);
                return (
                  <li key={task.id}>
                    <button
                      type="button"
                      onClick={() => navigate(`/task/${task.id}`)}
                      className="flex w-full items-start gap-3 py-3 text-left"
                    >
                      {task.incomplete && (
                        <span className="relative mt-1 flex h-2.5 w-2.5 shrink-0">
                          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-400 opacity-60" />
                          <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-red-600" />
                        </span>
                      )}
                      <span className="min-w-0 flex-1">
                        <span className={`block truncate text-sm font-medium ${
                          criticalTaskIds.has(task.id) ? "text-red-800" : "text-slate-800"
                        }`}>
                          {criticalTaskIds.has(task.id) ? "🔴 " : ""}{task.title}
                        </span>
                        <span className={`mt-1 block text-xs ${overdue ? "font-medium text-red-600" : "text-slate-500"}`}>
                          {overdue ? "已逾期 · " : "截止 "}
                          {task.deadline ? formatDate(new Date(`${task.deadline.slice(0, 10)}T00:00:00`)) : ""}
                        </span>
                      </span>
                      <span className="shrink-0 rounded-full bg-slate-100 px-2 py-1 text-[11px] text-slate-600">
                        {taskStatusLabels[task.status]}
                      </span>
                    </button>
                  </li>
                );
              })}
              {mobileTasks.length === 0 && (
                <li className="py-8 text-center text-sm text-slate-400">
                  {mobileView === "today" ? "今天没有到期或逾期任务" : "暂时没有待办任务"}
                </li>
              )}
            </ul>
          </section>
        </section>
      </div>
      <div className="hidden min-[640px]:block">
        <label className="mb-4 block">
          <span className="sr-only">搜索任务</span>
          <input
            id="workspace-search-desktop"
            type="search"
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                navigate(`/search?q=${encodeURIComponent(event.currentTarget.value)}`);
              }
            }}
            placeholder="搜索任务（搜索功能后续接入）"
            className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm shadow-sm outline-none focus:border-blue-600"
          />
        </label>
        <div className="grid gap-4 min-[640px]:grid-cols-1 min-[1024px]:grid-cols-[minmax(260px,340px)_minmax(0,1fr)]">
          <div className={collapsedList ? "min-[1024px]:hidden" : ""}>
            <TaskListPanel
              tasks={tasks}
              selectedId={selectedId}
              onSelect={onSelect}
              onCreate={() => void createAndSelect()}
              collapsed={collapsedList}
              onToggleCollapsed={() => setCollapsedList((value) => !value)}
              criticalTaskIds={criticalTaskIds}
            />
          </div>
          {selectedTask ? (
            <TaskEditor
              key={selectedTask.id}
              task={selectedTask}
              isCritical={criticalTaskIds.has(selectedTask.id)}
              onArchived={() => setSelectedId(undefined)}
            />
          ) : (
            <div className="flex min-h-64 items-center justify-center rounded-2xl border border-dashed border-slate-300 bg-white text-sm text-slate-500">
              新建或选择任务开始记录
            </div>
          )}
        </div>
      </div>
      {quickCaptureMode && (
        <QuickCapture
          mode={quickCaptureMode}
          onClose={() => setQuickCaptureMode(undefined)}
        />
      )}
    </>
  );
}

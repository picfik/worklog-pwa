import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import type { HistoryEvent } from "@/types/history";
import type { Task } from "@/types/task";
import { MarkdownContent } from "@/components/MarkdownContent";
import { useAppData } from "@/hooks/useAppData";
import { useMobileLayout } from "@/hooks/useMobileLayout";
import { TaskEditor } from "@/features/tasks/TaskEditor";
import { describeHistoryEvent, formatEventTime, taskStatusLabels } from "@/features/tasks/taskLabels";
import { formatDate } from "@/utils/date";
import { showToast } from "@/utils/toast";
import type { ArchiveShard } from "@/types/archive";
import { AttachmentPanel } from "@/features/attachments/AttachmentPanel";
import { useDailyAudit } from "@/hooks/useDailyAudit";
import { taskDirectoryMarkdown, downloadMarkdown, safeFilename } from "@/features/tasks/exportTask";

export function TaskDetailPage() {
  const { id } = useParams();
  const { data, error } = useAppData();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const isMobile = useMobileLayout();
  const [editing, setEditing] = useState(false);
  const [showMore, setShowMore] = useState(false);
  const initialFocus = searchParams.get("focus");
  const { findings: auditFindings } = useDailyAudit(data);

  const task: Task | undefined = data?.tasks.find((item) => item.id === id) ??
    Object.values(data?.archives ?? {}).flatMap((shard: ArchiveShard) => shard.tasks).find((item) => item.id === id);

  useEffect(() => {
    setEditing(
      task?.status !== "archived" &&
      (!isMobile || Boolean(initialFocus))
    );
  }, [isMobile, id, initialFocus, task?.status]);

  useEffect(() => {
    if (task?.status === "archived") {
      setEditing(false);
    }
  }, [task?.status]);

  const events = useMemo(() => {
    const activeEvents = (data?.statusHistory ?? []).filter((event) => event.taskId === id);
    const archivedEvents = Object.values(data?.archives ?? {})
      .flatMap((shard) => shard.historyEvents)
      .filter((event) => event.taskId === id);
    return [...activeEvents, ...archivedEvents].sort(
      (left, right) => Date.parse(right.at) - Date.parse(left.at)
    );
  }, [data, id]);

  function exportDirectory() {
    if (!task || !data) return;
    const attachments = data.attachments.filter((item) => item.taskId === task.id);
    const markdown = taskDirectoryMarkdown(task, attachments, events);
    downloadMarkdown(`${safeFilename(task.title)}-留痕目录.md`, markdown);
    setShowMore(false);
    showToast("留痕目录已导出");
  }

  function onArchived() {
    showToast("任务已归档");
    navigate("/", { replace: true });
  }

  if (error) {
    return <p className="rounded-xl bg-red-50 p-4 text-sm text-red-700" role="alert">{error}</p>;
  }
  if (!data) {
    return <p className="text-sm text-slate-500">正在读取任务…</p>;
  }
  if (!task) {
    return (
      <section className="rounded-2xl bg-white p-6">
        <h1 className="text-lg font-semibold">找不到这个任务</h1>
        <button type="button" onClick={() => navigate("/")} className="mt-4 text-sm text-blue-700">
          返回工作台
        </button>
      </section>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4 pb-24">
      <div className="flex justify-end">
        <div className="relative">
          <button
            type="button"
            aria-expanded={showMore}
            onClick={() => setShowMore((value) => !value)}
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700"
          >
            更多
          </button>
          {showMore && (
            <div className="absolute right-0 z-20 mt-1 w-48 rounded-lg border border-slate-200 bg-white p-1 shadow-lg">
              <button
                type="button"
                onClick={exportDirectory}
                className="w-full rounded-md px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50"
              >
                导出留痕目录
              </button>
            </div>
          )}
        </div>
      </div>
      {editing ? (
        <TaskEditor
          task={task}
          onArchived={onArchived}
          isCritical={(auditFindings ?? []).some(
            (finding) => finding.level === "red" && finding.taskId === task.id
          )}
          initialFocus={initialFocus}
        />
      ) : (
        <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-600">
              {taskStatusLabels[task.status]}
            </span>
            {task.deadline && (
              <span className="text-xs text-slate-500">
                截止：{formatDate(new Date(`${task.deadline.slice(0, 10)}T00:00:00`))}
              </span>
            )}
          </div>
          <h1 className="mt-4 text-2xl font-semibold text-slate-900">{task.title}</h1>
          {task.incomplete && (
            <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
              留痕不完整：尚未填写依据或添加依据附件。
            </p>
          )}
          {task.basisText && (
            <section className="mt-5">
              <h2 className="text-sm font-semibold text-slate-700">依据</h2>
              <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-slate-700">{task.basisText}</p>
            </section>
          )}
          {task.notes && (
            <section className="mt-5">
              <h2 className="mb-2 text-sm font-semibold text-slate-700">备注</h2>
              <MarkdownContent source={task.notes} />
            </section>
          )}
        </article>
      )}
      {!editing && (
        <AttachmentPanel
          taskId={task.id}
          taskTitle={task.title}
          canManage={task.status !== "archived"}
        />
      )}
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="font-semibold text-slate-900">留痕时间线</h2>
        {events.length > 0 ? (
          <ol className="mt-4 space-y-4">
            {events.map((event: HistoryEvent) => (
              <li key={event.id} className="relative border-l border-slate-200 pl-4">
                <span className="absolute -left-1 top-1 h-2 w-2 rounded-full bg-blue-600" />
                <time className="block text-xs text-slate-400">{formatEventTime(event.at)}</time>
                <p className="mt-1 text-sm text-slate-700">
                  {describeHistoryEvent(event.eventType, event.fromVal, event.toVal)}
                </p>
              </li>
            ))}
          </ol>
        ) : (
          <p className="mt-3 text-sm text-slate-400">暂无留痕事件</p>
        )}
      </section>
      {isMobile && task.status !== "archived" && (
        <div className="fixed inset-x-0 bottom-0 z-10 border-t border-slate-200 bg-white/95 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur">
          <button
            type="button"
            onClick={() => setEditing((value) => !value)}
            className="mx-auto block w-full max-w-3xl rounded-lg bg-navy px-4 py-3 text-sm font-semibold text-white"
          >
            {editing ? "完成编辑" : "编辑"}
          </button>
        </div>
      )}
    </div>
  );
}

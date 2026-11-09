import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import type { Task, TaskStatus } from "@/types/task";
import type { AttachmentRole } from "@/types/attachment";
import { archiveTask, changeStatus, updateTask } from "@/store/tasks";
import { MarkdownContent } from "@/components/MarkdownContent";
import { formatDate } from "@/utils/date";
import { showToast } from "@/utils/toast";
import { taskStatusLabels } from "@/features/tasks/taskLabels";
import { AttachmentPanel } from "@/features/attachments/AttachmentPanel";
import { useAppData } from "@/hooks/useAppData";
import { checkTransition, type TransitionGap } from "@/rules/gate";

interface TaskEditorProps {
  task: Task;
  onArchived?: () => void;
  isCritical?: boolean;
  initialFocus?: string | null;
}

interface Draft {
  title: string;
  basisText: string;
  deadline: string;
  notes: string;
}

const editableStatuses: TaskStatus[] = ["todo", "doing", "done"];

function isTaskStatus(value: string): value is TaskStatus {
  return value === "todo" || value === "doing" || value === "done" || value === "archived";
}

function draftFromTask(task: Task): Draft {
  return {
    title: task.title,
    basisText: task.basisText,
    deadline: task.deadline?.slice(0, 10) ?? "",
    notes: task.notes
  };
}

export function TaskEditor({
  task,
  onArchived,
  isCritical = false,
  initialFocus
}: TaskEditorProps) {
  const { data } = useAppData();
  const [draft, setDraft] = useState<Draft>(() => draftFromTask(task));
  const [previewNotes, setPreviewNotes] = useState(false);
  const [error, setError] = useState("");
  const [blockedGaps, setBlockedGaps] = useState<TransitionGap[]>();
  const [attachmentFocus, setAttachmentFocus] = useState<{
    role: AttachmentRole;
    token: number;
  }>({ role: "evidence", token: 0 });
  const basisRef = useRef<HTMLTextAreaElement>(null);
  const notesRef = useRef<HTMLTextAreaElement>(null);
  const taskAttachments = data?.attachments.filter((item) => item.taskId === task.id) ?? [];
  const draftTask = { ...task, ...draft };
  const doneGate = checkTransition(draftTask, taskAttachments, "done");
  const archiveGate = checkTransition(task, taskAttachments, "archived");

  useEffect(() => {
    setDraft(draftFromTask(task));
  }, [task.id, task.updatedAt, task.title, task.basisText, task.deadline, task.notes]);

  const dirtyFields = useMemo(() => {
    const changed: {
      title?: string;
      basisText?: string;
      deadline?: string | null;
      notes?: string;
    } = {};
    if (draft.title !== task.title) changed.title = draft.title;
    if (draft.basisText !== task.basisText) changed.basisText = draft.basisText;
    const deadline = draft.deadline || null;
    if (deadline !== task.deadline) changed.deadline = deadline;
    if (draft.notes !== task.notes) changed.notes = draft.notes;
    return changed;
  }, [draft, task]);

  useEffect(() => {
    if (Object.keys(dirtyFields).length === 0 || !draft.title.trim()) {
      return;
    }
    const timer = window.setTimeout(() => {
      setError("");
      void updateTask(task.id, dirtyFields).catch((saveError: unknown) => {
        const message = saveError instanceof Error ? saveError.message : "自动保存失败";
        setError(message);
      });
    }, 500);
    return () => window.clearTimeout(timer);
  }, [dirtyFields, draft.title, task.id]);

  useEffect(() => {
    if (!initialFocus) return;
    const timer = window.setTimeout(() => {
      if (initialFocus === "basis") {
        basisRef.current?.focus();
      } else if (initialFocus === "notes") {
        notesRef.current?.focus();
      } else {
        document.getElementById(`attachment-panel-${task.id}`)?.scrollIntoView({
          behavior: "smooth",
          block: "start"
        });
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [initialFocus, task.id]);

  function showTransitionGaps(status: TaskStatus) {
    if (!data) {
      showToast("正在加载任务和附件数据，请稍后再试");
      return false;
    }
    const check = checkTransition(draftTask, taskAttachments, status);
    if (!check.ok) setBlockedGaps(check.gaps);
    return check.ok;
  }

  async function handleStatusChange(status: TaskStatus) {
    try {
      if (!showTransitionGaps(status)) return;
      if (Object.keys(dirtyFields).length > 0) {
        await updateTask(task.id, dirtyFields);
      }
      await changeStatus(task.id, status);
      showToast(`状态已更新：${taskStatusLabels[status]}`);
    } catch (statusError: unknown) {
      setError(statusError instanceof Error ? statusError.message : "状态更新失败");
    }
  }

  async function handleArchive() {
    try {
      if (isCritical) {
        showToast("该任务存在红色巡检问题，请先处理后再归档");
        return;
      }
      if (!showTransitionGaps("archived")) return;
      if (Object.keys(dirtyFields).length > 0) {
        await updateTask(task.id, dirtyFields);
      }
      await archiveTask(task.id);
      showToast("任务已归档");
      onArchived?.();
    } catch (archiveError: unknown) {
      setError(archiveError instanceof Error ? archiveError.message : "归档失败");
    }
  }

  function goToGap(gap: TransitionGap) {
    setBlockedGaps(undefined);
    if (gap.jumpTo === "basis") {
      window.setTimeout(() => {
        basisRef.current?.focus();
        basisRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      }, 0);
      return;
    }
    if (gap.jumpTo === "notes") {
      setPreviewNotes(false);
      window.setTimeout(() => {
        notesRef.current?.focus();
        notesRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      }, 0);
      return;
    }
    const role: AttachmentRole = gap.jumpTo === "evidence" ? "evidence" : "reference";
    setAttachmentFocus((current) => ({ role, token: current.token + 1 }));
    window.setTimeout(() => {
      document.getElementById(`attachment-panel-${task.id}`)?.scrollIntoView({
        behavior: "smooth",
        block: "start"
      });
    }, 0);
  }

  async function confirmExtractedBasis() {
    try {
      await updateTask(task.id, { basisNeedsConfirmation: false });
      showToast("依据文号已确认");
    } catch (confirmError: unknown) {
      setError(confirmError instanceof Error ? confirmError.message : "确认依据文号失败");
    }
  }

  return (
    <article className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs text-slate-500">任务编辑</p>
          <p className="mt-1 text-xs text-slate-400">
            创建于 {formatDate(new Date(task.createdAt))}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <label className="sr-only" htmlFor={`status-${task.id}`}>任务状态</label>
          <select
            id={`status-${task.id}`}
            value={task.status}
            onChange={(event) => {
              const status = event.target.value;
              if (isTaskStatus(status)) void handleStatusChange(status);
            }}
            disabled={task.status === "archived"}
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
          >
            {editableStatuses.map((status) => (
              <option
                key={status}
                value={status}
                disabled={
                  status !== task.status &&
                  !(status === "doing" && task.status === "todo") &&
                  !(task.status === "doing" && status === "todo") &&
                  !(task.status === "doing" && status === "done" && (!data || !doneGate.ok))
                }
              >
                {taskStatusLabels[status]}
              </option>
            ))}
            {task.status === "archived" && <option value="archived">已归档</option>}
          </select>
          {task.status === "done" && (
            <button
              type="button"
              disabled={!data || !archiveGate.ok || isCritical}
              onClick={() => void handleArchive()}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"
            >
              归档
            </button>
          )}
        </div>
      </div>
      {task.status === "doing" && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={!data || !doneGate.ok}
            onClick={() => void handleStatusChange("done")}
            className="rounded-lg bg-navy px-3 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:bg-slate-300"
          >
            标记为已完成
          </button>
        </div>
      )}
      {task.status === "doing" && !doneGate.ok && (
        <div className="mt-4 flex flex-wrap items-center gap-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <span>办结门禁未通过，需补齐 {doneGate.gaps.length} 项。</span>
          <button
            type="button"
            onClick={() => setBlockedGaps(doneGate.gaps)}
            className="font-semibold underline"
          >
            查看办结缺口
          </button>
        </div>
      )}
      {task.status === "done" && !archiveGate.ok && (
        <div className="mt-4 flex flex-wrap items-center gap-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <span>归档门禁未通过，需补齐 {archiveGate.gaps.length} 项。</span>
          <button
            type="button"
            onClick={() => setBlockedGaps(archiveGate.gaps)}
            className="font-semibold underline"
          >
            查看归档缺口
          </button>
        </div>
      )}
      {isCritical && task.status === "done" && (
        <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">
          红色巡检问题尚未处理，归档已禁用。<Link className="font-semibold underline" to="/audit">前往巡检</Link>
        </p>
      )}

      <div className="mt-5 grid gap-4">
        <label className="grid gap-1.5 text-sm font-medium text-slate-700">
          标题
          <input
            id={`task-title-${task.id}`}
            value={draft.title}
            onChange={(event) => {
              const value = event.target.value;
              setDraft((current) => ({ ...current, title: value }));
              setError(value.trim() ? "" : "任务标题不能为空");
            }}
            className="rounded-lg border border-slate-300 px-3 py-2.5 text-base font-normal outline-none focus:border-blue-600"
          />
        </label>
        <label className="grid gap-1.5 text-sm font-medium text-slate-700">
          依据
          <textarea
            ref={basisRef}
            id={`basis-${task.id}`}
            rows={3}
            value={draft.basisText}
            onChange={(event) =>
              setDraft((current) => ({ ...current, basisText: event.target.value }))
            }
            placeholder="填写依据、文号或补充说明"
            className={`resize-y rounded-lg border px-3 py-2.5 font-normal outline-none focus:border-blue-600 ${
              task.basisNeedsConfirmation ? "border-amber-500 bg-amber-50" : "border-slate-300"
            }`}
          />
          {task.basisNeedsConfirmation && (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">
              <span>已从依据附件文件名提取文号，请核对后确认。</span>
              <button
                type="button"
                onClick={() => void confirmExtractedBasis()}
                className="font-semibold underline"
              >
                确认文号
              </button>
            </div>
          )}
        </label>
        <label className="grid gap-1.5 text-sm font-medium text-slate-700">
          截止日期
          <input
            type="date"
            value={draft.deadline}
            onChange={(event) =>
              setDraft((current) => ({ ...current, deadline: event.target.value }))
            }
            className="rounded-lg border border-slate-300 px-3 py-2.5 font-normal outline-none focus:border-blue-600"
          />
          {task.deadline && (
            <span className="font-normal text-slate-500">
              {formatDate(new Date(`${task.deadline.slice(0, 10)}T00:00:00`))}
            </span>
          )}
        </label>
        <div className="grid gap-1.5 text-sm font-medium text-slate-700">
          <div className="flex items-center justify-between">
            <label htmlFor={`notes-${task.id}`}>备注（支持 Markdown）</label>
            <button
              type="button"
              onClick={() => setPreviewNotes((value) => !value)}
              className="text-xs font-medium text-blue-700"
            >
              {previewNotes ? "返回编辑" : "预览"}
            </button>
          </div>
          {previewNotes ? (
            <MarkdownContent source={draft.notes} />
          ) : (
            <textarea
              ref={notesRef}
              id={`notes-${task.id}`}
              rows={7}
              value={draft.notes}
              onChange={(event) => setDraft((current) => ({ ...current, notes: event.target.value }))}
              placeholder="记录工作过程、沟通内容和后续事项"
              className="resize-y rounded-lg border border-slate-300 px-3 py-2.5 font-normal outline-none focus:border-blue-600"
            />
          )}
        </div>
      </div>
      {task.incomplete && (
        <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          留痕不完整：尚未填写依据或添加依据附件。
        </p>
      )}
      {error && <p className="mt-3 text-sm text-red-700" role="alert">{error}</p>}
      <p className="mt-3 text-xs text-slate-400" role="status">修改将在 500 毫秒后自动保存。</p>
      <div className="mt-5">
        <AttachmentPanel
          taskId={task.id}
          taskTitle={task.title}
          initialRole={attachmentFocus.role}
          focusToken={attachmentFocus.token}
        />
      </div>
      {blockedGaps && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/50 p-4">
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby={`gate-gaps-title-${task.id}`}
            className="w-full max-w-lg rounded-2xl bg-white p-5 shadow-xl"
          >
            <h2 id={`gate-gaps-title-${task.id}`} className="text-lg font-semibold text-slate-900">
              留痕缺口清单
            </h2>
            <ul className="mt-4 space-y-3">
              {blockedGaps.map((gap) => (
                <li key={`${gap.field}-${gap.jumpTo}`} className="flex items-start justify-between gap-3 rounded-lg bg-red-50 p-3">
                  <div>
                    <p className="text-sm font-semibold text-red-900">{gap.field}</p>
                    <p className="mt-1 text-xs leading-5 text-red-800">{gap.message}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => goToGap(gap)}
                    className="shrink-0 rounded-md bg-white px-2.5 py-1.5 text-xs font-semibold text-blue-700"
                  >
                    去补
                  </button>
                </li>
              ))}
            </ul>
            <button
              type="button"
              onClick={() => setBlockedGaps(undefined)}
              className="mt-4 w-full rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-700"
            >
              关闭
            </button>
          </section>
        </div>
      )}
    </article>
  );
}

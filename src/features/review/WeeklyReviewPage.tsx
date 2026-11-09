import { Link } from "react-router-dom";
import type { AuditFinding } from "@/rules/audit";
import type { LocalData } from "@/types/storage";
import { getAllTasks, calculateCompleteness } from "@/rules/audit";
import {
  completedEventsInRange,
  describeDateRange,
  getAllHistory,
  getMonday
} from "@/reports/periods";
import { formatDate } from "@/utils/date";

interface WeeklyReviewPageProps {
  data: LocalData;
  findings: AuditFinding[];
  onEnter: () => void;
}

function percentage(value: number | null): string {
  return value === null ? "—" : `${value}%`;
}

export function WeeklyReviewPage({ data, findings, onEnter }: WeeklyReviewPageProps) {
  const today = new Date();
  const thisMonday = getMonday(today);
  const previousMonday = new Date(thisMonday.getTime() - 7 * 24 * 60 * 60 * 1000);
  const weekBeforePrevious = new Date(previousMonday.getTime() - 7 * 24 * 60 * 60 * 1000);
  const history = getAllHistory(data);
  const tasks = getAllTasks(data);
  const previousWeekEvents = completedEventsInRange(history, previousMonday, thisMonday);
  const weekBeforeEvents = completedEventsInRange(history, weekBeforePrevious, previousMonday);
  const taskById = new Map(tasks.map((task) => [task.id, task]));
  const previousWeekTasks = Array.from(new Set(previousWeekEvents.map((event) => event.taskId)))
    .map((taskId) => taskById.get(taskId))
    .filter((task) => task !== undefined);
  const weekBeforeTasks = Array.from(new Set(weekBeforeEvents.map((event) => event.taskId)))
    .map((taskId) => taskById.get(taskId))
    .filter((task) => task !== undefined);
  const completeness = calculateCompleteness(previousWeekTasks, data.attachments);
  const previousCompleteness = calculateCompleteness(weekBeforeTasks, data.attachments);
  const weekDelta = completeness.rate === null || previousCompleteness.rate === null
    ? null
    : completeness.rate - previousCompleteness.rate;
  const redFindings = findings.filter((finding) => finding.level === "red" && finding.taskId);
  const redByTask = new Map<string, AuditFinding>();
  for (const finding of redFindings) {
    if (finding.taskId && !redByTask.has(finding.taskId)) {
      redByTask.set(finding.taskId, finding);
    }
  }
  const draggedTasks = tasks.filter((task) => {
    if (task.status !== "doing") return false;
    const updatedAt = Date.parse(task.updatedAt);
    return Number.isFinite(updatedAt) && updatedAt < previousMonday.getTime();
  });

  return (
    <main className="mx-auto flex min-h-[calc(100vh-3.5rem)] max-w-3xl flex-col gap-5">
      <header className="rounded-2xl bg-navy p-5 text-white shadow-sm sm:p-7">
        <p className="text-sm text-blue-100">每周一 · 强制回顾</p>
        <h1 className="mt-2 text-2xl font-semibold">上周工作回顾</h1>
        <p className="mt-2 text-sm text-blue-100">
          回顾区间：{describeDateRange(previousMonday, thisMonday)}
        </p>
      </header>

      <section className="grid gap-3 sm:grid-cols-2">
        <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-sm text-slate-500">上周办结</p>
          <p className="mt-1 text-3xl font-semibold text-navy">{previousWeekTasks.length} 条</p>
          <p className="mt-1 text-xs text-slate-500">按状态进入“已完成”的留痕记录统计</p>
        </article>
        <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-sm text-slate-500">留痕完整率</p>
          <p className="mt-1 text-3xl font-semibold text-navy">{percentage(completeness.rate)}</p>
          <p className="mt-1 text-xs text-slate-500">
            {completeness.complete}/{completeness.total} 条完整
            {" · "}前一周 {percentage(previousCompleteness.rate)}
            {" · "}周环比{" "}
            {weekDelta === null ? "暂无对比" : `${weekDelta > 0 ? "+" : ""}${weekDelta} 个百分点`}
          </p>
        </article>
      </section>

      <section className="rounded-2xl border border-red-200 bg-white p-5 shadow-sm">
        <h2 className="font-semibold text-red-800">🔴 欠账清单（{redByTask.size}）</h2>
        {redByTask.size > 0 ? (
          <ul className="mt-3 space-y-2">
            {Array.from(redByTask, ([taskId, finding]) => (
              <li key={taskId} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-red-50 p-3">
                <div>
                  <p className="text-sm font-medium text-red-900">{finding.taskTitle ?? "待处理任务"}</p>
                  <p className="mt-1 text-xs text-red-800">{finding.title}：{finding.message}</p>
                </div>
                <Link
                  to={`/task/${taskId}?focus=${finding.jumpTo}`}
                  className="rounded-lg bg-white px-3 py-2 text-xs font-semibold text-red-800"
                >
                  现在补
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-sm text-slate-500">暂无红色欠账。</p>
        )}
      </section>

      <section className="rounded-2xl border border-amber-200 bg-white p-5 shadow-sm">
        <h2 className="font-semibold text-amber-900">🟡 拖了一周的事（{draggedTasks.length}）</h2>
        {draggedTasks.length > 0 ? (
          <ul className="mt-3 space-y-2">
            {draggedTasks.map((task) => (
              <li key={task.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-amber-50 p-3">
                <div>
                  <p className="text-sm font-medium text-amber-950">{task.title}</p>
                  <p className="mt-1 text-xs text-amber-800">
                    自 {formatDate(new Date(task.updatedAt))} 起未更新
                  </p>
                </div>
                <Link to={`/task/${task.id}?focus=notes`} className="text-xs font-semibold text-blue-700 underline">
                  查看并更新
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-sm text-slate-500">没有超过一周未更新的进行中任务。</p>
        )}
      </section>

      <footer className="sticky bottom-0 mt-auto rounded-t-2xl border border-slate-200 bg-white/95 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur">
        <button
          type="button"
          onClick={onEnter}
          className="w-full rounded-xl bg-navy px-4 py-3 text-sm font-semibold text-white"
        >
          进入工作台
        </button>
      </footer>
    </main>
  );
}

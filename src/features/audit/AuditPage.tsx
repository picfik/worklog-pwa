import { useMemo } from "react";
import { Link } from "react-router-dom";
import { useAppData } from "@/hooks/useAppData";
import { useDailyAudit } from "@/hooks/useDailyAudit";
import { calculateCompleteness, getAllTasks, type AuditLevel } from "@/rules/audit";

const levels: Array<{
  level: AuditLevel;
  icon: string;
  title: string;
  color: string;
}> = [
  { level: "red", icon: "🔴", title: "严重问题", color: "border-red-200 bg-red-50 text-red-900" },
  { level: "yellow", icon: "🟡", title: "需关注", color: "border-amber-200 bg-amber-50 text-amber-900" },
  { level: "green", icon: "🟢", title: "改进建议", color: "border-emerald-200 bg-emerald-50 text-emerald-900" }
];

function getWeeklyRanges(now: Date): { currentStart: Date; previousStart: Date } {
  const currentStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const previousStart = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
  return { currentStart, previousStart };
}

function percentage(value: number | null): string {
  return value === null ? "—" : `${value}%`;
}

export function AuditPage() {
  const { data, error } = useAppData();
  const { findings, error: auditError } = useDailyAudit(data);
  const now = new Date();
  const summary = useMemo(() => {
    if (!data) return undefined;
    const tasks = getAllTasks(data);
    const { currentStart, previousStart } = getWeeklyRanges(now);
    const completionTimes = new Map<string, string>();
    const events = [
      ...data.statusHistory,
      ...Object.values(data.archives).flatMap((shard) => shard.historyEvents)
    ];
    for (const event of events) {
      if (event.toVal !== "done" && event.toVal !== "archived") continue;
      const current = completionTimes.get(event.taskId);
      if (!current || Date.parse(event.at) > Date.parse(current)) {
        completionTimes.set(event.taskId, event.at);
      }
    }
    const overall = calculateCompleteness(tasks, data.attachments);
    const current = calculateCompleteness(
      tasks,
      data.attachments,
      currentStart,
      now,
      completionTimes
    );
    const previous = calculateCompleteness(
      tasks,
      data.attachments,
      previousStart,
      currentStart,
      completionTimes
    );
    const delta = current.rate === null || previous.rate === null
      ? null
      : current.rate - previous.rate;
    return { overall, current, previous, delta };
  }, [data, now.getTime()]);

  if (error) {
    return <p className="rounded-xl bg-red-50 p-4 text-sm text-red-700" role="alert">{error}</p>;
  }
  if (!data || !summary) {
    return <p className="text-sm text-slate-500">正在读取巡检数据…</p>;
  }

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-xl font-semibold text-slate-900">留痕合规看板</h1>
        <p className="mt-1 text-sm text-slate-500">
          每天首次打开时执行巡检，结果缓存至当天；附件和任务修改后次日重新巡检。
        </p>
      </header>

      <section className="grid gap-3 sm:grid-cols-3">
        <article className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-sm text-slate-500">留痕完整率</p>
          <p className="mt-1 text-3xl font-semibold text-navy">{percentage(summary.overall.rate)}</p>
          <p className="mt-1 text-xs text-slate-500">
            已完成任务中 {summary.overall.complete}/{summary.overall.total} 条的依据、佐证和备注齐全
          </p>
        </article>
        <article className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:col-span-2">
          <p className="text-sm text-slate-500">周环比（近 7 天 vs 前 7 天）</p>
          <div className="mt-2 flex flex-wrap items-baseline gap-x-4 gap-y-1">
            <p className="text-2xl font-semibold text-slate-900">{percentage(summary.current.rate)}</p>
            <p className="text-sm text-slate-500">
              前 7 天 {percentage(summary.previous.rate)}
              {summary.delta === null ? "" : ` · ${summary.delta > 0 ? "+" : ""}${summary.delta} 个百分点`}
            </p>
          </div>
          <p className="mt-1 text-xs text-slate-500">
            近 7 天 {summary.current.complete}/{summary.current.total} 条完整，前 7 天 {summary.previous.complete}/{summary.previous.total} 条完整
          </p>
        </article>
      </section>

      {auditError && (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900" role="alert">
          巡检结果读取失败：{auditError}
        </p>
      )}

      {levels.map(({ level, icon, title, color }) => {
        const items = (findings ?? []).filter((finding) => finding.level === level);
        return (
          <section key={level} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <h2 className="flex items-center gap-2 font-semibold text-slate-900">
              <span>{icon}</span>
              <span>{title}</span>
              <span className="text-xs font-normal text-slate-400">{items.length} 项</span>
            </h2>
            {items.length === 0 ? (
              <p className="mt-3 text-sm text-slate-400">暂无问题</p>
            ) : (
              <ul className="mt-3 space-y-2">
                {items.map((finding) => (
                  <li key={finding.id} className={`rounded-xl border p-3 ${color}`}>
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold">{finding.title}</p>
                        {finding.taskTitle && (
                          <p className="mt-1 text-xs font-medium">任务：{finding.taskTitle}</p>
                        )}
                        <p className="mt-1 text-sm leading-6">{finding.message}</p>
                      </div>
                      {finding.taskId && (
                        <Link
                          to={`/task/${finding.taskId}?focus=${finding.jumpTo}`}
                          className="shrink-0 rounded-lg bg-white px-3 py-2 text-xs font-semibold text-blue-700 shadow-sm"
                        >
                          现在补
                        </Link>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}

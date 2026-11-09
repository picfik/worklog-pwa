import { useEffect, useMemo, useState } from "react";
import type { LocalData } from "@/types/storage";
import { createMonthlyReport, eventDescription, monthlyReportMarkdown, type MonthlyReport } from "@/reports/periods";
import { getAllTasks } from "@/rules/audit";
import { downloadMarkdown, safeFilename } from "@/features/tasks/exportTask";

interface MonthlyReportBannerProps {
  data?: LocalData;
  visible?: boolean;
}

function isMonthlyReport(value: unknown): value is MonthlyReport {
  if (typeof value !== "object" || value === null) return false;
  const report = value as Record<string, unknown>;
  const completeness = report.completeness;
  const validCompleteness = typeof completeness === "object" &&
    completeness !== null &&
    typeof (completeness as Record<string, unknown>).complete === "number" &&
    typeof (completeness as Record<string, unknown>).total === "number" &&
    ((completeness as Record<string, unknown>).rate === null ||
      typeof (completeness as Record<string, unknown>).rate === "number");
  const validTrend = Array.isArray(report.trend) && report.trend.every((item: unknown) => {
    if (typeof item !== "object" || item === null) return false;
    const trendItem = item as Record<string, unknown>;
    return typeof trendItem.label === "string" &&
      typeof trendItem.complete === "number" &&
      typeof trendItem.total === "number" &&
      (trendItem.rate === null || typeof trendItem.rate === "number");
  });
  const validGaps = Array.isArray(report.gaps) && report.gaps.every((item: unknown) => {
    if (typeof item !== "object" || item === null) return false;
    const gap = item as Record<string, unknown>;
    return typeof gap.label === "string" && typeof gap.count === "number";
  });
  const validRoles = typeof report.attachmentsByRole === "object" &&
    report.attachmentsByRole !== null &&
    Object.values(report.attachmentsByRole).every((count) => typeof count === "number");
  const validTimeline = Array.isArray(report.timeline) && report.timeline.every((item: unknown) => {
    if (typeof item !== "object" || item === null) return false;
    const event = item as Record<string, unknown>;
    return typeof event.id === "string" &&
      typeof event.taskId === "string" &&
      typeof event.eventType === "string" &&
      typeof event.at === "string" &&
      typeof event.deviceId === "string";
  });
  return typeof report.month === "string" &&
    typeof report.completedCount === "number" &&
    (typeof report.averageDurationDays === "number" || report.averageDurationDays === null) &&
    validCompleteness &&
    validTrend &&
    validGaps &&
    typeof report.attachmentCount === "number" &&
    validRoles &&
    validTimeline;
}

function monthKey(date: Date): string {
  const previousMonth = new Date(date.getFullYear(), date.getMonth() - 1, 1);
  return `${previousMonth.getFullYear()}-${String(previousMonth.getMonth() + 1).padStart(2, "0")}`;
}

function reportLabel(date: Date): string {
  return `${date.getFullYear()}年${date.getMonth() + 1}月`;
}

function rateLabel(rate: number | null): string {
  return rate === null ? "—" : `${rate}%`;
}

export function MonthlyReportBanner({ data, visible = true }: MonthlyReportBannerProps) {
  const today = new Date();
  const [report, setReport] = useState<MonthlyReport>();
  const [error, setError] = useState("");
  const [showReport, setShowReport] = useState(false);
  const isFirstDay = today.getDate() === 1;
  const targetMonth = useMemo(() => new Date(today.getFullYear(), today.getMonth() - 1, 1), [today.getFullYear(), today.getMonth()]);

  useEffect(() => {
    if (!isFirstDay || !data) return;
    const key = `monthlyReport-${monthKey(today)}`;
    try {
      const cached = localStorage.getItem(key);
      if (cached) {
        const parsed: unknown = JSON.parse(cached);
        if (isMonthlyReport(parsed)) {
          setReport(parsed);
          return;
        }
        console.warn(`月报缓存格式无效，将重新生成：${key}`);
      }
      const generated = createMonthlyReport(data, targetMonth);
      localStorage.setItem(key, JSON.stringify(generated));
      setReport(generated);
      setError("");
    } catch (generationError: unknown) {
      setError(generationError instanceof Error ? generationError.message : "月度报告生成失败");
    }
  }, [data, isFirstDay, targetMonth]);

  if (!visible || !isFirstDay || !data || !report) {
    if (visible && error && isFirstDay) {
      return <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900" role="status">{error}</p>;
    }
    return null;
  }

  const markdown = monthlyReportMarkdown(report, getAllTasks(data));
  const taskNames = new Map(getAllTasks(data).map((task) => [task.id, task.title]));
  return (
    <>
      <section className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-blue-200 bg-blue-50 px-3 py-3">
        <div>
          <p className="text-sm font-semibold text-blue-950">{reportLabel(targetMonth)}月度报告已生成</p>
          <p className="mt-1 text-xs text-blue-800">
            办结 {report.completedCount} 条 · 留痕完整率 {rateLabel(report.completeness.rate)} · 附件 {report.attachmentCount} 个
          </p>
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={() => setShowReport(true)} className="rounded-lg bg-white px-3 py-2 text-xs font-semibold text-blue-800">
            查看报告
          </button>
          <button
            type="button"
            onClick={() => downloadMarkdown(`${safeFilename(reportLabel(targetMonth))}-月度报告.md`, markdown)}
            className="rounded-lg bg-navy px-3 py-2 text-xs font-semibold text-white"
          >
            导出 Markdown
          </button>
        </div>
      </section>
      {showReport && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/50 p-4">
          <section role="dialog" aria-modal="true" aria-labelledby="monthly-report-title" className="max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-5 shadow-xl">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 id="monthly-report-title" className="text-lg font-semibold text-slate-900">{reportLabel(targetMonth)}月度报告</h2>
                <p className="mt-1 text-sm text-slate-500">办结 {report.completedCount} 条 · 平均办理 {report.averageDurationDays === null ? "暂无数据" : `${report.averageDurationDays} 天`}</p>
              </div>
              <button type="button" onClick={() => setShowReport(false)} className="rounded-lg px-3 py-1 text-sm text-slate-500">关闭</button>
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <div className="rounded-lg bg-slate-50 p-3">
                <p className="text-xs text-slate-500">留痕完整率</p>
                <p className="mt-1 text-xl font-semibold text-navy">{rateLabel(report.completeness.rate)}</p>
              </div>
              <div className="rounded-lg bg-slate-50 p-3">
                <p className="text-xs text-slate-500">附件总数</p>
                <p className="mt-1 text-xl font-semibold text-navy">{report.attachmentCount}</p>
              </div>
            </div>
            <h3 className="mt-5 text-sm font-semibold">完整率趋势</h3>
            <ul className="mt-2 space-y-1 text-sm text-slate-600">
              {report.trend.map((item) => <li key={item.label}>{item.label} 起：{item.complete}/{item.total}（{rateLabel(item.rate)}）</li>)}
            </ul>
            <h3 className="mt-5 text-sm font-semibold">高频缺口</h3>
            <ul className="mt-2 space-y-1 text-sm text-slate-600">
              {report.gaps.length ? report.gaps.map((item) => <li key={item.label}>{item.label}：{item.count}</li>) : <li>无明显缺口</li>}
            </ul>
            <h3 className="mt-5 text-sm font-semibold">附件统计</h3>
            <p className="mt-2 text-sm text-slate-600">共 {report.attachmentCount} 个附件</p>
            <ul className="mt-1 space-y-1 text-sm text-slate-600">
              {Object.entries(report.attachmentsByRole).map(([role, count]) => (
                <li key={role}>{role}：{count} 个</li>
              ))}
            </ul>
            <h3 className="mt-5 text-sm font-semibold">时间线摘录</h3>
            <ul className="mt-2 space-y-1 text-xs leading-5 text-slate-600">
              {report.timeline.slice(0, 5).map((event) => (
                <li key={`${event.id}-${event.at}`}>
                  {event.at.slice(0, 16).replace("T", " ")} · {taskNames.get(event.taskId) ?? "已归档任务"}
                  {" · "}{eventDescription(event)}
                </li>
              ))}
              {report.timeline.length === 0 && <li>暂无记录</li>}
            </ul>
            <button type="button" onClick={() => downloadMarkdown(`${safeFilename(reportLabel(targetMonth))}-月度报告.md`, markdown)} className="mt-5 w-full rounded-lg bg-navy px-4 py-2.5 text-sm font-semibold text-white">
              导出 Markdown 报告
            </button>
          </section>
        </div>
      )}
    </>
  );
}

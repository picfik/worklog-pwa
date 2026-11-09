import type { HistoryEvent } from "@/types/history";
import type { LocalData } from "@/types/storage";
import type { Task } from "@/types/task";
import { getAllTasks, calculateCompleteness } from "@/rules/audit";
import { formatDate } from "@/utils/date";
import { substantiveNotes } from "@/utils/notes";

const DAY_MS = 24 * 60 * 60 * 1000;

export function getAllHistory(data: LocalData): HistoryEvent[] {
  return [
    ...data.statusHistory,
    ...Object.values(data.archives).flatMap((shard) => shard.historyEvents)
  ].sort((left, right) => Date.parse(right.at) - Date.parse(left.at));
}

export function getIsoWeekKey(date: Date): string {
  const utcDate = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = utcDate.getUTCDay() || 7;
  utcDate.setUTCDate(utcDate.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(utcDate.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((utcDate.getTime() - yearStart.getTime()) / DAY_MS + 1) / 7);
  return `${utcDate.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

export function getMonday(date: Date): Date {
  const monday = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const weekday = monday.getDay() || 7;
  monday.setDate(monday.getDate() - weekday + 1);
  monday.setHours(0, 0, 0, 0);
  return monday;
}

export function getEventsInRange(
  events: HistoryEvent[],
  start: Date,
  end: Date
): HistoryEvent[] {
  return events.filter((event) => {
    const time = Date.parse(event.at);
    return Number.isFinite(time) && time >= start.getTime() && time < end.getTime();
  });
}

export function completedEventsInRange(
  events: HistoryEvent[],
  start: Date,
  end: Date
): HistoryEvent[] {
  return getEventsInRange(events, start, end).filter(
    (event) => event.eventType === "status_changed" && event.toVal === "done"
  );
}

export interface MonthlyReport {
  month: string;
  completedCount: number;
  averageDurationDays: number | null;
  completeness: { complete: number; total: number; rate: number | null };
  trend: Array<{ label: string; complete: number; total: number; rate: number | null }>;
  gaps: Array<{ label: string; count: number }>;
  attachmentCount: number;
  attachmentsByRole: Record<string, number>;
  timeline: HistoryEvent[];
}

function monthStart(year: number, monthIndex: number): Date {
  return new Date(year, monthIndex, 1);
}

export function createMonthlyReport(
  data: LocalData,
  monthDate: Date
): MonthlyReport {
  const start = monthStart(monthDate.getFullYear(), monthDate.getMonth());
  const end = monthStart(monthDate.getFullYear(), monthDate.getMonth() + 1);
  const tasks = getAllTasks(data);
  const taskById = new Map(tasks.map((task) => [task.id, task]));
  const events = getAllHistory(data);
  const completedEvents = completedEventsInRange(events, start, end);
  const completedTaskIds = Array.from(new Set(completedEvents.map((event) => event.taskId)));
  const completedTasks = completedTaskIds
    .map((taskId) => taskById.get(taskId))
    .filter((task): task is Task => task !== undefined);
  const durations = completedEvents.flatMap((event) => {
    const task = taskById.get(event.taskId);
    const created = task ? Date.parse(task.createdAt) : Number.NaN;
    const completed = Date.parse(event.at);
    return Number.isFinite(created) && completed >= created
      ? [(completed - created) / DAY_MS]
      : [];
  });
  const completionTimes = new Map<string, string>();
  for (const event of completedEvents) {
    const previous = completionTimes.get(event.taskId);
    if (!previous || Date.parse(event.at) < Date.parse(previous)) {
      completionTimes.set(event.taskId, event.at);
    }
  }
  const completeness = calculateCompleteness(
    completedTasks,
    data.attachments,
    undefined,
    undefined,
    completionTimes
  );

  const trend: MonthlyReport["trend"] = [];
  let weekStart = new Date(start);
  while (weekStart < end) {
    const daysUntilNextMonday = (8 - weekStart.getDay()) % 7 || 7;
    const nextWeek = new Date(weekStart);
    nextWeek.setDate(nextWeek.getDate() + daysUntilNextMonday);
    const weekEnd = nextWeek < end ? nextWeek : end;
    const weekEvents = completedEvents.filter((event) => {
      const time = Date.parse(event.at);
      return time >= weekStart.getTime() && time < weekEnd.getTime();
    });
    const weekTasks = Array.from(new Set(weekEvents.map((event) => event.taskId)))
      .map((taskId) => taskById.get(taskId))
      .filter((task): task is Task => task !== undefined);
    const stats = calculateCompleteness(weekTasks, data.attachments);
    trend.push({
      label: `${weekStart.getMonth() + 1}/${weekStart.getDate()}`,
      complete: stats.complete,
      total: stats.total,
      rate: stats.rate
    });
    weekStart = weekEnd;
  }

  const gaps = [
    {
      label: "缺少依据",
      count: completedTasks.filter((task) =>
        !task.basisText.trim() &&
        !data.attachments.some((item) => item.taskId === task.id && item.role === "basis")
      ).length
    },
    {
      label: "缺少已上传佐证",
      count: completedTasks.filter((task) =>
        !data.attachments.some(
          (item) => item.taskId === task.id && item.role === "evidence" && item.ossKey.trim()
        )
      ).length
    },
    {
      label: "缺少办理说明",
      count: completedTasks.filter((task) => !substantiveNotes(task.notes)).length
    }
  ].filter((item) => item.count > 0).sort((left, right) => right.count - left.count);

  const monthlyAttachments = data.attachments.filter((attachment) => {
    const uploaded = Date.parse(attachment.uploadedAt);
    return Number.isFinite(uploaded) && uploaded >= start.getTime() && uploaded < end.getTime();
  });
  const attachmentsByRole: Record<string, number> = {};
  for (const attachment of monthlyAttachments) {
    attachmentsByRole[attachment.role] = (attachmentsByRole[attachment.role] ?? 0) + 1;
  }

  return {
    month: `${start.getFullYear()}年${start.getMonth() + 1}月`,
    completedCount: completedTaskIds.length,
    averageDurationDays: durations.length > 0
      ? Math.round((durations.reduce((sum, duration) => sum + duration, 0) / durations.length) * 10) / 10
      : null,
    completeness,
    trend,
    gaps,
    attachmentCount: monthlyAttachments.length,
    attachmentsByRole,
    timeline: getEventsInRange(events, start, end).slice(0, 20)
  };
}

export function monthlyReportMarkdown(report: MonthlyReport, tasks: Task[]): string {
  const taskById = new Map(tasks.map((task) => [task.id, task.title]));
  const trend = report.trend.map((item) =>
    `| ${item.label} 起 | ${item.complete}/${item.total} | ${item.rate === null ? "—" : `${item.rate}%`} |`
  );
  const gaps = report.gaps.length > 0
    ? report.gaps.map((item) => `- ${item.label}：${item.count} 条`)
    : ["- 无明显缺口"];
  const roles = Object.entries(report.attachmentsByRole)
    .map(([role, count]) => `- ${roleLabel(role)}：${count} 个`);
  const timeline = report.timeline.map((event) =>
    `- ${formatDate(new Date(event.at))} ${event.at.slice(11, 16)} · ${taskById.get(event.taskId) ?? "已归档任务"} · ${eventDescription(event)}`
  );
  return [
    `# ${report.month}工作留痕月报`,
    "",
    `- 办结任务：${report.completedCount} 条`,
    `- 平均办理时长：${report.averageDurationDays === null ? "暂无数据" : `${report.averageDurationDays} 天`}`,
    `- 留痕完整率：${report.completeness.rate === null ? "—" : `${report.completeness.rate}%`}（${report.completeness.complete}/${report.completeness.total}）`,
    `- 附件：${report.attachmentCount} 个`,
    "",
    "## 留痕完整率趋势",
    "",
    "| 周起始 | 完整数/办结数 | 完整率 |",
    "| --- | ---: | ---: |",
    ...trend,
    "",
    "## 高频缺口",
    "",
    ...gaps,
    "",
    "## 附件统计",
    "",
    ...(roles.length > 0 ? roles : ["- 无附件"]),
    "",
    "## 时间线摘录（最多 20 条）",
    "",
    ...(timeline.length > 0 ? timeline : ["- 无记录"]),
    ""
  ].join("\n");
}

export function roleLabel(role: string): string {
  const labels: Record<string, string> = {
    basis: "依据",
    evidence: "佐证",
    reference: "参考",
    draft: "草稿",
    other: "其他"
  };
  return labels[role] ?? role;
}

export function eventDescription(event: HistoryEvent): string {
  if (event.eventType === "status_changed") {
    return `状态变更：${event.fromVal ?? "新建"} → ${event.toVal ?? "未知"}`;
  }
  if (event.eventType === "created") return "创建任务";
  if (event.eventType === "attachment_added") return `添加附件：${event.toVal ?? ""}`;
  if (event.eventType === "role_changed") return `调整附件角色：${event.fromVal ?? ""} → ${event.toVal ?? ""}`;
  if (event.eventType === "deadline_changed") return "调整截止日期";
  if (event.eventType === "notes_updated") return "更新依据或备注";
  return "记录了同步事件";
}

export function describeDateRange(start: Date, end: Date): string {
  const inclusiveEnd = new Date(end.getTime() - 1);
  return `${formatDate(start)} 至 ${formatDate(inclusiveEnd)}`;
}

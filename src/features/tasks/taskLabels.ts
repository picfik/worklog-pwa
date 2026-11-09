import type { TaskStatus } from "@/types/task";
import { formatDate, formatDateTime } from "@/utils/date";

export const taskStatusLabels: Record<TaskStatus, string> = {
  todo: "待办",
  doing: "进行中",
  done: "已完成",
  archived: "已归档"
};

export function formatEventTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "时间未知";
  }
  return formatDateTime(date);
}

function statusLabel(value: string): string {
  if (value === "todo" || value === "doing" || value === "done" || value === "archived") {
    return taskStatusLabels[value];
  }
  return value;
}

export function describeHistoryEvent(
  eventType: string,
  fromVal?: string,
  toVal?: string
): string {
  if (eventType === "created") {
    return "创建了任务";
  }
  if (eventType === "status_changed") {
    const before = fromVal ? statusLabel(fromVal) : "新建";
    const after = toVal ? statusLabel(toVal) : "未知";
    return `状态从 ${before} 变为 ${after}`;
  }
  if (eventType === "deadline_changed") {
    const formatDeadline = (value: string | undefined) => {
      if (!value) return "未设置";
      const date = new Date(`${value.slice(0, 10)}T00:00:00`);
      return Number.isNaN(date.getTime()) ? value : formatDate(date);
    };
    return `截止日期从 ${formatDeadline(fromVal)} 调整为 ${formatDeadline(toVal)}`;
  }
  if (eventType === "notes_updated") {
    return "更新了依据或备注";
  }
  return "记录了任务变更";
}

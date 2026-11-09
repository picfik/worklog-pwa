import type { Attachment } from "@/types/attachment";
import type { HistoryEvent } from "@/types/history";
import type { Task } from "@/types/task";
import { describeHistoryEvent, formatEventTime, taskStatusLabels } from "@/features/tasks/taskLabels";
import { roleLabel } from "@/reports/periods";
import { formatDate, formatDateTime } from "@/utils/date";
import { formatFileSize } from "@/features/attachments/attachmentPresentation";

function markdownCell(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\r?\n/g, "<br>");
}

function formattedDate(value: string | null): string {
  if (!value) return "未设置";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : formatDate(date);
}

function formattedDateTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : formatDateTime(date);
}

export function taskDirectoryMarkdown(
  task: Task,
  attachments: Attachment[],
  history: HistoryEvent[]
): string {
  const attachmentRows = attachments.length > 0
    ? attachments.map((attachment) => [
        `| ${markdownCell(attachment.name)}`,
        roleLabel(attachment.role),
        formatFileSize(attachment.size),
        attachment.sha256 ? attachment.sha256.slice(0, 8) : "未校验",
        attachment.uploadedAt
          ? formattedDateTime(attachment.uploadedAt)
          : "尚未上传"
      ].join(" | ") + " |")
    : ["| 无附件 | — | — | — | — |"];
  const events = [...history].sort((left, right) => Date.parse(left.at) - Date.parse(right.at));
  const historyLines = events.length > 0
    ? events.map((event) =>
        `- ${formatEventTime(event.at)} · ${describeHistoryEvent(event.eventType, event.fromVal, event.toVal)} · 设备 ${event.deviceId}`
      )
    : ["- 暂无留痕事件"];

  return [
    `# ${task.title}`,
    "",
    `- 状态：${taskStatusLabels[task.status]}`,
    `- 创建时间：${formattedDateTime(task.createdAt)}`,
    `- 更新时间：${formattedDateTime(task.updatedAt)}`,
    `- 截止日期：${formattedDate(task.deadline)}`,
    `- 留痕不完整：${task.incomplete ? "是" : "否"}`,
    "",
    "## 办理依据",
    "",
    task.basisText.trim() || "暂无",
    "",
    "## 办理说明",
    "",
    task.notes.trim() || "暂无",
    "",
    "## 附件清单",
    "",
    "| 文件名 | 角色 | 大小 | SHA-256 前 8 位 | 上传时间 |",
    "| --- | --- | ---: | --- | --- |",
    ...attachmentRows,
    "",
    "## 完整留痕历史",
    "",
    ...historyLines,
    ""
  ].join("\n");
}

export function downloadMarkdown(filename: string, markdown: string): void {
  const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.rel = "noopener";
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function safeFilename(value: string): string {
  return value.replace(/[\\/:*?"<>|]+/g, "_").trim() || "任务";
}

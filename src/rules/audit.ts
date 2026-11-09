import type { Attachment } from "@/types/attachment";
import type { PendingUpload, LocalData } from "@/types/storage";
import type { Task } from "@/types/task";
import { extractDocumentNumbers } from "@/utils/documentNumber";
import { substantiveNotes } from "@/utils/notes";
import { formatDate } from "@/utils/date";

export type AuditLevel = "red" | "yellow" | "green";
export type AuditJumpTarget = "basis" | "evidence" | "notes" | "attachments";

export interface AuditFinding {
  id: string;
  level: AuditLevel;
  title: string;
  message: string;
  taskId?: string;
  taskTitle?: string;
  attachmentId?: string;
  jumpTo: AuditJumpTarget;
}

export interface AuditCompleteness {
  complete: number;
  total: number;
  rate: number | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const MIN_NOTE_LENGTH = 10;

export function getAllTasks(data: LocalData): Task[] {
  return [
    ...data.tasks,
    ...Object.values(data.archives).flatMap((shard) => shard.tasks)
  ];
}

function hasBasis(task: Task, attachments: Attachment[]): boolean {
  return Boolean(task.basisText.trim()) ||
    attachments.some((item) => item.taskId === task.id && item.role === "basis");
}

function hasUploadedEvidence(task: Task, attachments: Attachment[]): boolean {
  return attachments.some(
    (item) => item.taskId === task.id && item.role === "evidence" && item.ossKey.trim()
  );
}

function isComplete(task: Task, attachments: Attachment[]): boolean {
  return hasBasis(task, attachments) &&
    hasUploadedEvidence(task, attachments) &&
    substantiveNotes(task.notes).length > 0;
}

function taskFinding(
  task: Task,
  id: string,
  level: AuditLevel,
  title: string,
  message: string,
  jumpTo: AuditJumpTarget
): AuditFinding {
  return { id, level, title, message, taskId: task.id, taskTitle: task.title, jumpTo };
}

export function runAudit(
  tasks: Task[],
  attachments: Attachment[],
  pendingUploads: PendingUpload[],
  now = new Date()
): AuditFinding[] {
  const findings: AuditFinding[] = [];
  const nowMs = now.getTime();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();

  for (const task of tasks) {
    const taskAttachments = attachments.filter((item) => item.taskId === task.id);
    if (
      (task.status === "done" || task.status === "archived") &&
      !hasUploadedEvidence(task, attachments)
    ) {
      findings.push(taskFinding(
        task,
        `completed-no-evidence-${task.id}`,
        "red",
        "已完成无佐证",
        "任务已完成，但没有已上传的结果佐证附件。",
        "evidence"
      ));
    }
    if (task.status === "doing" && !hasBasis(task, attachments)) {
      findings.push(taskFinding(
        task,
        `doing-no-basis-${task.id}`,
        "red",
        "进行中无依据",
        "任务处于进行中，但未填写依据或添加依据附件。",
        "basis"
      ));
    }

    if (task.status === "todo" || task.status === "doing") {
      if (task.deadline) {
        const deadlineDate = new Date(`${task.deadline.slice(0, 10)}T00:00:00`);
        const deadline = deadlineDate.getTime();
        const formattedDeadline = Number.isNaN(deadline) ? task.deadline : formatDate(deadlineDate);
        if (!Number.isNaN(deadline) && deadline < today) {
          findings.push(taskFinding(
            task,
            `overdue-${task.id}`,
            "yellow",
            "任务逾期",
            `截止日期为 ${formattedDeadline}，请更新进度或补充说明。`,
            "notes"
          ));
        } else if (!Number.isNaN(deadline) && deadline <= today + 2 * DAY_MS) {
          findings.push(taskFinding(
            task,
            `due-soon-${task.id}`,
            "yellow",
            "任务临期",
            `任务将在 ${formattedDeadline} 到期（两天内）。`,
            "notes"
          ));
        }
      }
      const updatedAt = Date.parse(task.updatedAt);
      if (
        task.status === "doing" &&
        !Number.isNaN(updatedAt) &&
        nowMs - updatedAt > 7 * DAY_MS
      ) {
        findings.push(taskFinding(
          task,
          `stagnant-${task.id}`,
          "yellow",
          "长期停滞",
          "任务已超过 7 天没有更新。",
          "notes"
        ));
      }
    }

    const referenceNumbers = extractDocumentNumbers(task.basisText);
    const evidenceText = taskAttachments
      .filter((item) => item.role === "evidence")
      .map((item) => `${item.name} ${item.note ?? ""}`)
      .join(" ");
    for (const number of referenceNumbers) {
      if (!evidenceText.includes(number)) {
        findings.push(taskFinding(
          task,
          `reference-not-in-evidence-${task.id}-${number}`,
          "green",
          "依据文号未在佐证出现",
          `依据文号“${number}”未在佐证附件名称或备注中找到，请人工核对。`,
          "evidence"
        ));
      }
    }

    if (substantiveNotes(task.notes).length < MIN_NOTE_LENGTH) {
      findings.push(taskFinding(
        task,
        `short-notes-${task.id}`,
        "green",
        "备注过短",
        "备注的实际内容少于 10 个字符，建议补充办理过程或结果。",
        "notes"
      ));
    }
  }

  for (const attachment of attachments) {
    if (attachment.role === "other") {
      const task = tasks.find((item) => item.id === attachment.taskId);
      findings.push({
        id: `unclassified-${attachment.id}`,
        level: "yellow",
        title: "附件未归类",
        message: `附件“${attachment.name}”仍归为“其他”。`,
        taskId: attachment.taskId,
        taskTitle: task?.title,
        attachmentId: attachment.id,
        jumpTo: "attachments"
      });
    }
  }

  for (const upload of pendingUploads) {
    const createdAt = upload.createdAt ? Date.parse(upload.createdAt) : Number.NaN;
    if (!Number.isNaN(createdAt) && nowMs - createdAt > DAY_MS) {
      const task = tasks.find((item) => item.id === upload.attachment.taskId);
      findings.push({
        id: `pending-upload-${upload.attachment.id}`,
        level: "yellow",
        title: "附件待上传超 24 小时",
        message: `附件“${upload.attachment.name}”已在本地等待上传超过 24 小时。`,
        taskId: upload.attachment.taskId,
        taskTitle: task?.title,
        attachmentId: upload.attachment.id,
        jumpTo: "attachments"
      });
    }
  }

  return findings;
}

export function calculateCompleteness(
  tasks: Task[],
  attachments: Attachment[],
  from?: Date,
  until?: Date,
  completionTimes?: Map<string, string>
): AuditCompleteness {
  const completedTasks = tasks.filter((task) => {
    if (task.status !== "done" && task.status !== "archived") return false;
    const completionAt = completionTimes?.get(task.id) ?? task.updatedAt;
    const completedTime = Date.parse(completionAt);
    if (from && (Number.isNaN(completedTime) || completedTime < from.getTime())) return false;
    if (until && (Number.isNaN(completedTime) || completedTime >= until.getTime())) return false;
    return true;
  });
  const complete = completedTasks.filter((task) => isComplete(task, attachments)).length;
  return {
    complete,
    total: completedTasks.length,
    rate: completedTasks.length > 0 ? Math.round((complete / completedTasks.length) * 100) : null
  };
}

function isAuditFinding(value: unknown): value is AuditFinding {
  if (typeof value !== "object" || value === null) return false;
  const item = value as Record<string, unknown>;
  return typeof item.id === "string" &&
    (item.level === "red" || item.level === "yellow" || item.level === "green") &&
    typeof item.title === "string" &&
    typeof item.message === "string" &&
    (item.taskId === undefined || typeof item.taskId === "string") &&
    (item.taskTitle === undefined || typeof item.taskTitle === "string") &&
    (item.attachmentId === undefined || typeof item.attachmentId === "string") &&
    (item.jumpTo === "basis" ||
      item.jumpTo === "evidence" ||
      item.jumpTo === "notes" ||
      item.jumpTo === "attachments");
}

function localDateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function getDailyAudit(
  tasks: Task[],
  attachments: Attachment[],
  pendingUploads: PendingUpload[],
  now = new Date()
): AuditFinding[] {
  const cacheKey = `audit-${localDateKey(now)}`;
  try {
    const cached = localStorage.getItem(cacheKey);
    if (cached !== null) {
      const parsed: unknown = JSON.parse(cached);
      if (Array.isArray(parsed) && parsed.every(isAuditFinding)) {
        return parsed;
      }
      console.warn(`巡检缓存格式无效，将重新计算：${cacheKey}`);
    }
  } catch (error: unknown) {
    console.error("读取巡检缓存失败，将重新计算", error);
  }

  const findings = runAudit(tasks, attachments, pendingUploads, now);
  try {
    localStorage.setItem(cacheKey, JSON.stringify(findings));
  } catch (error: unknown) {
    console.error("保存巡检缓存失败", error);
  }
  return findings;
}

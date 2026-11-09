import type { Attachment } from "@/types/attachment";
import type { Task, TaskStatus } from "@/types/task";
import { substantiveNotes } from "@/utils/notes";

export type GateJumpTarget = "basis" | "evidence" | "notes" | "attachments";

export interface TransitionGap {
  field: string;
  message: string;
  jumpTo: GateJumpTarget;
}

export interface TransitionCheck {
  ok: boolean;
  gaps: TransitionGap[];
}

export function checkTransition(
  task: Task,
  attachments: Attachment[],
  targetStatus: TaskStatus
): TransitionCheck {
  const taskAttachments = attachments.filter((item) => item.taskId === task.id);
  const gaps: TransitionGap[] = [];

  if (task.status === "doing" && targetStatus === "done") {
    const hasBasisAttachment = taskAttachments.some((item) => item.role === "basis");
    const evidence = taskAttachments.filter((item) => item.role === "evidence");
    if (!task.basisText.trim() && !hasBasisAttachment) {
      gaps.push({
        field: "办理依据",
        message: "请填写依据文本或添加依据附件。",
        jumpTo: "basis"
      });
    }
    if (evidence.length === 0 || evidence.some((item) => !item.ossKey.trim())) {
      gaps.push({
        field: "结果佐证",
        message: evidence.length === 0
          ? "至少添加一份结果佐证附件。"
          : "结果佐证中有附件尚未上传完成。",
        jumpTo: "evidence"
      });
    }
    if (!substantiveNotes(task.notes)) {
      gaps.push({
        field: "办理说明",
        message: "请填写办理说明或处理结果。",
        jumpTo: "notes"
      });
    }
  }

  if (task.status === "done" && targetStatus === "archived") {
    if (taskAttachments.some((item) => item.role === "other")) {
      gaps.push({
        field: "附件归类",
        message: "请先为所有“其他”附件选择正确的角色。",
        jumpTo: "attachments"
      });
    }
    if (taskAttachments.some((item) => !item.sha256.trim())) {
      gaps.push({
        field: "附件校验",
        message: "仍有附件没有完成上传和 SHA-256 校验。",
        jumpTo: "attachments"
      });
    }
  }

  return { ok: gaps.length === 0, gaps };
}

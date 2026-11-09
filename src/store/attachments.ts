import type { Attachment, AttachmentRole } from "@/types/attachment";
import { getDatabase } from "@/store/db";
import { loadData, markDirty } from "@/store/dataRepository";
import {
  getPendingUploads,
  removePendingUpload
} from "@/store/pendingUploadsRepository";
import { addPendingDeletion } from "@/store/pendingDeletionsRepository";
import { addHistory } from "@/store/tasks";
import { extractDocumentNumbers } from "@/utils/documentNumber";
import { readJpegDateTimeOriginal } from "@/utils/exif";

export interface AddAttachmentInput {
  taskId: string;
  file: File;
  role?: AttachmentRole;
}

export interface AttachmentFilter {
  query?: string;
  role?: AttachmentRole | "all";
  format?: "all" | "image" | "pdf" | "text" | "office" | "archive" | "other";
  taskId?: string;
  sort?: "newest" | "oldest" | "name" | "size";
}

function getExtension(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot >= 0 ? name.slice(dot + 1).toLowerCase() : "";
}

function notifyDataChanged(): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event("worklog:data-changed"));
  }
}

export async function addAttachment(input: AddAttachmentInput): Promise<Attachment> {
  const data = await loadData();
  if (!data.tasks.some((task) => task.id === input.taskId)) {
    throw new Error("找不到所属任务");
  }
  const file = input.file;
  let capturedAt: string | undefined;
  if (file.type === "image/jpeg" || /\.(jpe?g)$/i.test(file.name)) {
    try {
      capturedAt = await readJpegDateTimeOriginal(file);
    } catch (error: unknown) {
      console.warn(`读取照片拍摄时间失败：${file.name}`, error);
    }
  }
  const reusable = data.attachments.find(
    (item) => item.ossKey.trim().length > 0 && item.name === file.name && item.size === file.size
  );
  const attachment: Attachment = {
    id: crypto.randomUUID(),
    taskId: input.taskId,
    role: input.role ?? "evidence",
    name: file.name,
    mime: file.type || "application/octet-stream",
    ext: getExtension(file.name),
    size: file.size,
    sha256: reusable?.sha256 ?? "",
    ossKey: reusable?.ossKey ?? "",
    uploadedAt: reusable?.uploadedAt ?? "",
    ...(capturedAt ? { capturedAt } : {})
  };
  const database = await getDatabase();
  let pendingId: number | undefined;
  if (!reusable) {
    pendingId = await database.add("pendingUploads", {
      blob: file,
      attachment,
      createdAt: new Date().toISOString()
    });
  }
  let autoBasisChange: { from: string; to: string } | undefined;
  try {
    data.attachments.push(attachment);
    const task = data.tasks.find((item) => item.id === input.taskId);
    if (task && attachment.role === "basis") {
      const referenceNumbers = extractDocumentNumbers(file.name);
      if (referenceNumbers.length > 0) {
        const extracted = referenceNumbers.join("、");
        if (!task.basisText.includes(extracted)) {
          const previousBasis = task.basisText;
          task.basisText = task.basisText.trim()
            ? `${task.basisText.trim()}\n${extracted}`
            : extracted;
          autoBasisChange = { from: previousBasis, to: task.basisText };
        }
        task.basisNeedsConfirmation = true;
        task.updatedAt = new Date().toISOString();
      }
    }
    if (task?.status === "doing" && task.basisText.trim().length === 0) {
      task.incomplete = !data.attachments.some(
        (item) => item.taskId === task.id && item.role === "basis"
      );
    }
    await addHistory({
      taskId: input.taskId,
      eventType: "attachment_added",
      toVal: `${attachment.name}（${attachment.role}）`
    });
    if (autoBasisChange) {
      await addHistory({
        taskId: input.taskId,
        eventType: "notes_updated",
        fromVal: autoBasisChange.from,
        toVal: autoBasisChange.to
      });
    }
    await markDirty();
    notifyDataChanged();
    return attachment;
  } catch (error: unknown) {
    if (pendingId !== undefined) {
      await removePendingUpload(pendingId);
    }
    throw error;
  }
}

export async function updateRole(
  attachmentId: string,
  role: AttachmentRole
): Promise<Attachment> {
  const data = await loadData();
  const attachment = data.attachments.find((item) => item.id === attachmentId);
  if (!attachment) {
    throw new Error("找不到附件");
  }
  const previousRole = attachment.role;
  if (previousRole === role) {
    return attachment;
  }
  attachment.role = role;
  const task = data.tasks.find((item) => item.id === attachment.taskId);
  if (task?.status === "doing" && task.basisText.trim().length === 0) {
    task.incomplete = !data.attachments.some(
      (item) => item.taskId === task.id && item.role === "basis"
    );
  }
  await addHistory({
    taskId: attachment.taskId,
    eventType: "role_changed",
    fromVal: previousRole,
    toVal: role
  });
  await markDirty();
  notifyDataChanged();
  return attachment;
}

export async function updateNote(attachmentId: string, note: string): Promise<Attachment> {
  const data = await loadData();
  const attachment = data.attachments.find((item) => item.id === attachmentId);
  if (!attachment) {
    throw new Error("找不到附件");
  }
  attachment.note = note;
  await addHistory({
    taskId: attachment.taskId,
    eventType: "notes_updated",
    fromVal: attachment.name,
    toVal: note
  });
  await markDirty();
  notifyDataChanged();
  return attachment;
}

export async function deleteAttachment(attachmentId: string): Promise<void> {
  const data = await loadData();
  const index = data.attachments.findIndex((item) => item.id === attachmentId);
  const attachment = data.attachments[index];
  if (!attachment || index < 0) {
    throw new Error("找不到附件");
  }
  data.attachments.splice(index, 1);
  const task = data.tasks.find((item) => item.id === attachment.taskId);
  if (task?.status === "doing" && task.basisText.trim().length === 0) {
    task.incomplete = !data.attachments.some(
      (item) => item.taskId === task.id && item.role === "basis"
    );
  }
  const pending = await getPendingUploads();
  for (const upload of pending) {
    if (upload.attachment.id === attachmentId && upload.id !== undefined) {
      await removePendingUpload(upload.id);
    }
  }
  const ossKey = attachment.ossKey.trim();
  const stillReferenced =
    ossKey.length > 0 && data.attachments.some((item) => item.ossKey === ossKey);
  if (ossKey && !stillReferenced) {
    await addPendingDeletion(ossKey);
  }
  await addHistory({
    taskId: attachment.taskId,
    eventType: "notes_updated",
    fromVal: `删除附件：${attachment.name}`,
    toVal: "附件登记已删除"
  });
  await markDirty();
  notifyDataChanged();
  if (ossKey && !stillReferenced && typeof window !== "undefined") {
    window.dispatchEvent(new Event("worklog:sync-request"));
  }
}

export async function listByTask(taskId: string): Promise<Attachment[]> {
  const data = await loadData();
  return data.attachments.filter((attachment) => attachment.taskId === taskId);
}

function matchesFormat(
  attachment: Attachment,
  format: NonNullable<AttachmentFilter["format"]>
): boolean {
  if (format === "all") return true;
  const ext = attachment.ext.toLowerCase();
  if (format === "image") return attachment.mime.startsWith("image/");
  if (format === "pdf") return ext === "pdf" || attachment.mime === "application/pdf";
  if (format === "text") {
    return attachment.mime.startsWith("text/") || ["md", "csv", "json", "xml"].includes(ext);
  }
  if (format === "office") {
    return ["doc", "docx", "xls", "xlsx", "ppt", "pptx"].includes(ext);
  }
  if (format === "archive") {
    return ["zip", "rar", "7z", "tar", "gz"].includes(ext);
  }
  return !matchesFormat(attachment, "image") &&
    !matchesFormat(attachment, "pdf") &&
    !matchesFormat(attachment, "text") &&
    !matchesFormat(attachment, "office") &&
    !matchesFormat(attachment, "archive");
}

export async function listAll(filter: AttachmentFilter = {}): Promise<Attachment[]> {
  const data = await loadData();
  const query = filter.query?.trim().toLocaleLowerCase();
  const tasksById = new Map([
    ...data.tasks.map((task) => [task.id, task.title] as const),
    ...Object.values(data.archives).flatMap((shard) =>
      shard.tasks.map((task) => [task.id, task.title] as const)
    )
  ]);
  const results = data.attachments.filter((attachment) => {
    if (filter.role && filter.role !== "all" && attachment.role !== filter.role) return false;
    if (filter.taskId && attachment.taskId !== filter.taskId) return false;
    if (filter.format && !matchesFormat(attachment, filter.format)) return false;
    if (
      query &&
      !attachment.name.toLocaleLowerCase().includes(query) &&
      !(attachment.note ?? "").toLocaleLowerCase().includes(query) &&
      !(tasksById.get(attachment.taskId) ?? "").toLocaleLowerCase().includes(query)
    ) {
      return false;
    }
    return true;
  });
  const sort = filter.sort ?? "newest";
  return results.sort((left, right) => {
    if (sort === "name") return left.name.localeCompare(right.name);
    if (sort === "size") return right.size - left.size;
    const timeDelta = Date.parse(right.uploadedAt || "") - Date.parse(left.uploadedAt || "");
    return sort === "oldest" ? -timeDelta : timeDelta;
  });
}

export async function markUploaded(
  attachmentId: string,
  ossKey: string,
  sha256: string
): Promise<Attachment> {
  if (!ossKey || !sha256) {
    throw new Error("上传完成信息不完整");
  }
  const data = await loadData();
  const attachment = data.attachments.find((item) => item.id === attachmentId);
  if (!attachment) {
    throw new Error("找不到上传中的附件");
  }
  attachment.ossKey = ossKey;
  attachment.sha256 = sha256;
  attachment.uploadedAt = new Date().toISOString();
  const pending = await getPendingUploads();
  for (const upload of pending) {
    if (upload.attachment.id === attachmentId && upload.id !== undefined) {
      await removePendingUpload(upload.id);
    }
  }
  await markDirty();
  notifyDataChanged();
  return attachment;
}

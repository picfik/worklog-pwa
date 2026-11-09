import JSZip from "jszip";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { DragEvent } from "react";
import type { Attachment, AttachmentRole } from "@/types/attachment";
import { useAppData } from "@/hooks/useAppData";
import {
  addAttachment,
  deleteAttachment,
  updateNote,
  updateRole
} from "@/store/attachments";
import { downloadAttachment, fetchAttachmentBlob, getReadUrl } from "@/oss/download";
import { uploadPendingAttachment } from "@/oss/upload";
import { fileIcon, formatFileSize, isTextAttachment, canPreview } from "@/features/attachments/attachmentPresentation";
import { showToast } from "@/utils/toast";
import { sha256Hex } from "@/utils/hash";

const roles: AttachmentRole[] = ["basis", "evidence", "reference", "draft", "other"];
const roleLabels: Record<AttachmentRole, string> = {
  basis: "依据",
  evidence: "佐证",
  reference: "参考",
  draft: "草稿",
  other: "其他"
};
const MAX_ZIP_SIZE = 100 * 1024 * 1024;
const ARCHIVE_EXTENSIONS = new Set(["zip", "rar", "7z", "tar", "gz"]);

interface BatchFile {
  id: string;
  file: File;
  role: AttachmentRole;
}

interface UploadState {
  progress: number;
  error?: string;
}

interface PreviewState {
  attachment: Attachment;
  url?: string;
  text?: string;
}

interface AttachmentPanelProps {
  taskId: string;
  taskTitle: string;
  canManage?: boolean;
  initialRole?: AttachmentRole;
  focusToken?: number;
}

function toastError(error: unknown, fallback: string): void {
  showToast(error instanceof Error ? error.message : fallback);
}

export function AttachmentPanel({
  taskId,
  taskTitle,
  canManage = true,
  initialRole = "evidence",
  focusToken = 0
}: AttachmentPanelProps) {
  const { data } = useAppData();
  const [batch, setBatch] = useState<BatchFile[]>([]);
  const [batchRole, setBatchRole] = useState<AttachmentRole>(initialRole);
  const [uploadStates, setUploadStates] = useState<Record<string, UploadState>>({});
  const [preview, setPreview] = useState<PreviewState>();
  const [busy, setBusy] = useState(false);

  const attachments = useMemo(
    () => (data?.attachments ?? []).filter((item) => item.taskId === taskId),
    [data?.attachments, taskId]
  );
  const unclassifiedCount = attachments.filter((item) => item.role === "other").length;

  const setUploadState = useCallback((id: string, value: UploadState) => {
    setUploadStates((current) => ({ ...current, [id]: value }));
  }, []);

  const uploadOne = useCallback(async (attachmentId: string) => {
    setUploadState(attachmentId, { progress: 0 });
    try {
      await uploadPendingAttachment(attachmentId, (progress) => {
        setUploadState(attachmentId, { progress });
      });
      setUploadState(attachmentId, { progress: 100 });
      showToast("附件上传完成");
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "附件上传失败";
      setUploadState(attachmentId, { progress: 0, error: message });
      showToast(message);
    }
  }, [setUploadState]);

  const addAndUpload = useCallback(async (file: File, role: AttachmentRole) => {
    const attachment = await addAttachment({ taskId, file, role });
    if (role === "other") {
      showToast("附件归为其他，请在巡检中检查未归类附件");
    }
    if (attachment.ossKey) {
      showToast(`同名同大小文件已存在，直接复用云端副本：${attachment.name}`);
      return;
    }
    await uploadOne(attachment.id);
  }, [taskId, uploadOne]);

  const enqueueFiles = useCallback((
    files: File[],
    role: AttachmentRole,
    inferUnclassifiedArchives = false
  ) => {
    if (files.length === 0) return;
    const batchFiles = files.map((file) => ({
      id: crypto.randomUUID(),
      file,
      role: inferUnclassifiedArchives &&
        ARCHIVE_EXTENSIONS.has(file.name.split(".").pop()?.toLowerCase() ?? "")
        ? "other" as const
        : role
    }));
    setBatch((current) => [...current, ...batchFiles]);
    setBatchRole(role);
  }, []);

  useEffect(() => {
    function onPaste(event: ClipboardEvent) {
      const files = Array.from(event.clipboardData?.files ?? []);
      if (files.length > 0) {
        event.preventDefault();
        enqueueFiles(files, "evidence", true);
      }
    }
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [enqueueFiles]);

  useEffect(() => {
    setBatchRole(initialRole);
    if (focusToken === 0) return;
    const timer = window.setTimeout(() => {
      document.getElementById(`attachment-select-${taskId}`)?.focus();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [focusToken, initialRole, taskId]);

  async function submitBatch() {
    if (batch.length === 0 || busy) return;
    setBusy(true);
    try {
      for (const item of batch) {
        await addAndUpload(item.file, item.role);
      }
      setBatch([]);
    } catch (error: unknown) {
      toastError(error, "加入上传队列失败");
    } finally {
      setBusy(false);
    }
  }

  async function handleDrop(event: DragEvent, role: AttachmentRole) {
    event.preventDefault();
    const files = Array.from(event.dataTransfer.files);
    for (const file of files) {
      try {
        await addAndUpload(file, role);
      } catch (error: unknown) {
        toastError(error, "加入上传队列失败");
      }
    }
  }

  async function openPreview(attachment: Attachment) {
    try {
      if (isTextAttachment(attachment)) {
        const blob = await fetchAttachmentBlob(attachment);
        setPreview({ attachment, text: await blob.text() });
      } else {
        const url = await getReadUrl(attachment.ossKey);
        setPreview({ attachment, url });
      }
    } catch (error: unknown) {
      toastError(error, "无法预览附件");
    }
  }

  async function downloadOne(attachment: Attachment) {
    try {
      const result = await downloadAttachment(attachment);
      if (!result.shaMatches) {
        showToast(`下载校验不一致：${attachment.name}，请检查 OSS 文件`);
      } else {
        showToast(`已开始下载：${attachment.name}`);
      }
    } catch (error: unknown) {
      toastError(error, "附件下载失败");
    }
  }

  async function downloadZip() {
    const uploaded = attachments.filter((item) => item.ossKey);
    if (uploaded.length === 0) {
      showToast("当前任务没有已上传的附件");
      return;
    }
    const totalSize = uploaded.reduce((sum, item) => sum + item.size, 0);
    if (totalSize > MAX_ZIP_SIZE) {
      showToast("附件总大小超过 100 MB，请分批下载");
      return;
    }
    setBusy(true);
    try {
      const zip = new JSZip();
      const usedNames = new Set<string>();
      for (const attachment of uploaded) {
        const blob = await fetchAttachmentBlob(attachment);
        const calculated = await sha256Hex(await blob.arrayBuffer());
        if (attachment.sha256 && calculated !== attachment.sha256) {
          showToast(`下载校验不一致：${attachment.name}，请检查 OSS 文件`);
        }
        const dot = attachment.name.lastIndexOf(".");
        const stem = dot > 0 ? attachment.name.slice(0, dot) : attachment.name;
        const extension = dot > 0 ? attachment.name.slice(dot) : "";
        let zipName = attachment.name;
        let suffix = 2;
        while (usedNames.has(zipName)) {
          zipName = `${stem} (${suffix})${extension}`;
          suffix += 1;
        }
        usedNames.add(zipName);
        zip.file(zipName, blob);
      }
      const blob = await zip.generateAsync({ type: "blob" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${taskTitle}-附件包-${new Date().toISOString().slice(0, 10)}.zip`;
      link.rel = "noopener";
      document.body.append(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      showToast("附件包已生成");
    } catch (error: unknown) {
      toastError(error, "打包下载失败");
    } finally {
      setBusy(false);
    }
  }

  async function handleRoleChange(attachment: Attachment, role: AttachmentRole) {
    try {
      await updateRole(attachment.id, role);
      if (role === "other") {
        showToast("附件已归为其他，请在巡检中检查未归类附件");
      }
    } catch (error: unknown) {
      toastError(error, "修改附件分类失败");
    }
  }

  async function handleNote(attachment: Attachment) {
    const note = window.prompt("编辑附件备注", attachment.note ?? "");
    if (note === null) return;
    try {
      await updateNote(attachment.id, note);
    } catch (error: unknown) {
      toastError(error, "保存附件备注失败");
    }
  }

  async function handleDelete(attachment: Attachment) {
    if (
      !window.confirm(
        `删除“${attachment.name}”？若其他任务没有引用该文件，云端 OSS 文件也会同步删除。`
      )
    ) {
      return;
    }
    try {
      await deleteAttachment(attachment.id);
      showToast("附件已删除（云端文件将同步清理）");
    } catch (error: unknown) {
      toastError(error, "删除附件登记失败");
    }
  }

  return (
    <section
      id={`attachment-panel-${taskId}`}
      className="scroll-mt-20 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-semibold text-slate-900">任务附件</h2>
          <p className="mt-1 text-xs text-slate-500">
            附件本体带签名直传 OSS；密钥仅存本机浏览器。
          </p>
        </div>
        <button
          type="button"
          disabled={busy}
          onClick={() => void downloadZip()}
          className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-medium text-slate-700 disabled:opacity-50"
        >
          打包下载
        </button>
      </div>

      {canManage && (
        <div
          className="mt-4 rounded-xl border border-dashed border-slate-300 bg-slate-50 p-4"
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => void handleDrop(event, batchRole)}
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-slate-600">选择、粘贴或拖拽文件到下方角色分组。</p>
            <label
              id={`attachment-select-${taskId}`}
              tabIndex={0}
              className="cursor-pointer rounded-lg bg-navy px-3 py-2 text-xs font-semibold text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              选择多个文件
              <input
                id={`attachment-file-input-${taskId}`}
                type="file"
                multiple
                className="sr-only"
                onChange={(event) => {
                  enqueueFiles(Array.from(event.target.files ?? []), "evidence", true);
                  event.currentTarget.value = "";
                }}
              />
            </label>
          </div>
          <p className="mt-2 text-xs text-slate-400">
            目标角色：
            {roles.map((role) => (
              <button
                key={role}
                type="button"
                onClick={() => setBatchRole(role)}
                className={`ml-1 rounded px-1.5 py-0.5 ${
                  batchRole === role ? "bg-blue-100 font-medium text-navy" : "text-slate-500"
                }`}
              >
                {roleLabels[role]}
              </button>
            ))}
            <span className="ml-2">Ctrl/Cmd+V 可粘贴文件</span>
          </p>
        </div>
      )}

      {batch.length > 0 && canManage && (
        <div className="mt-4 rounded-xl border border-blue-200 bg-blue-50/50 p-3">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-slate-800">
              上传归类（普通文件默认佐证，压缩包默认其他）
            </h3>
            <button
              type="button"
              onClick={() => setBatch([])}
              className="text-xs text-slate-500"
              aria-label="清空所选文件"
            >
              清空所选
            </button>
          </div>
          <ul className="mt-2 divide-y divide-blue-100">
            {batch.map((item) => (
              <li key={item.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span className="min-w-0 flex-1 truncate text-sm">{item.file.name}</span>
                <label className="sr-only" htmlFor={`batch-role-${item.id}`}>附件角色</label>
                <select
                  id={`batch-role-${item.id}`}
                  value={item.role}
                  onChange={(event) =>
                    setBatch((current) =>
                      current.map((entry) =>
                        entry.id === item.id
                          ? { ...entry, role: event.target.value as AttachmentRole }
                          : entry
                      )
                    )
                  }
                  className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs"
                >
                  {roles.map((role) => (
                    <option key={role} value={role}>{roleLabels[role]}</option>
                  ))}
                </select>
              </li>
            ))}
          </ul>
          {batch.some((item) => item.role === "other") && (
            <p className="mt-2 text-xs text-amber-800">
              归为“其他”的附件会出现在巡检的未归类提醒中。
            </p>
          )}
          <button
            type="button"
            disabled={busy}
            onClick={() => void submitBatch()}
            className="mt-3 w-full rounded-lg bg-navy px-3 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
          >
            确认归类并上传
          </button>
        </div>
      )}

      {unclassifiedCount > 0 && (
        <p className="mt-4 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
          有 {unclassifiedCount} 个附件归为“其他”，请检查并重新归类。
        </p>
      )}
      <div className="mt-4 space-y-3">
        {roles.map((role) => {
          const group = attachments.filter((item) => item.role === role);
          return (
            <section
              key={role}
              onDragOver={(event) => {
                if (canManage) event.preventDefault();
              }}
              onDrop={(event) => {
                if (canManage) void handleDrop(event, role);
              }}
              className="rounded-xl border border-slate-100 p-3"
            >
              <h3 className="flex items-center justify-between text-sm font-semibold text-slate-700">
                <span>{roleLabels[role]}</span>
                <span className="text-xs font-normal text-slate-400">{group.length}</span>
              </h3>
              {group.length === 0 ? (
                <p className="pt-2 text-xs text-slate-400">
                  {canManage ? "拖拽文件到此处即可归类" : "暂无附件"}
                </p>
              ) : (
                <ul className="mt-2 divide-y divide-slate-100">
                  {group.map((attachment) => {
                    const state = uploadStates[attachment.id];
                    const uploaded = Boolean(attachment.ossKey);
                    return (
                      <li key={attachment.id} className="py-3">
                        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:gap-2">
                          <div className="flex min-w-0 flex-1 items-start gap-2">
                            <span className="text-lg" aria-hidden="true">{fileIcon(attachment)}</span>
                            <div className="min-w-0 flex-1">
                              <p className="break-all text-sm font-medium text-slate-800">
                                {attachment.name}
                              </p>
                              <p className="mt-0.5 text-xs text-slate-400">
                                {attachment.ext ? `${attachment.ext.toUpperCase()} · ` : ""}
                                {formatFileSize(attachment.size)}
                                {uploaded ? ` · ${new Date(attachment.uploadedAt).toLocaleString("zh-CN")}` : " · 待上传"}
                              </p>
                              {attachment.note && (
                                <p className="mt-1 break-words text-xs text-slate-500">{attachment.note}</p>
                              )}
                            </div>
                          </div>
                          <div className="flex flex-wrap items-center gap-1 pl-7 sm:pl-0">
                            {canPreview(attachment) && uploaded && (
                              <button
                                type="button"
                                onClick={() => void openPreview(attachment)}
                                className="rounded-md px-2 py-1 text-xs text-blue-700 hover:bg-blue-50"
                              >
                                预览
                              </button>
                            )}
                            <button
                              type="button"
                              disabled={!uploaded}
                              onClick={() => void downloadOne(attachment)}
                              className="rounded-md px-2 py-1 text-xs text-blue-700 hover:bg-blue-50 disabled:text-slate-300"
                            >
                              下载
                            </button>
                            {canManage && (
                              <>
                                <label className="sr-only" htmlFor={`role-${attachment.id}`}>修改附件角色</label>
                                <select
                                  id={`role-${attachment.id}`}
                                  value={role}
                                  onChange={(event) =>
                                    void handleRoleChange(attachment, event.target.value as AttachmentRole)
                                  }
                                  className="max-w-20 rounded-md border border-slate-200 bg-white px-1 py-1 text-xs"
                                >
                                  {roles.map((item) => (
                                    <option key={item} value={item}>{roleLabels[item]}</option>
                                  ))}
                                </select>
                                <button
                                  type="button"
                                  onClick={() => void handleNote(attachment)}
                                  className="rounded-md px-2 py-1 text-xs text-slate-600 hover:bg-slate-100"
                                >
                                  备注
                                </button>
                                <button
                                  type="button"
                                  onClick={() => void handleDelete(attachment)}
                                  className="rounded-md px-2 py-1 text-xs text-red-700 hover:bg-red-50"
                                >
                                  删除
                                </button>
                              </>
                            )}
                          </div>
                        </div>
                        {!uploaded && (
                          <div className="mt-2">
                            {state?.error ? (
                              <p className="mb-1 text-xs text-red-700" role="alert">{state.error}</p>
                            ) : state ? (
                              <p className="mb-1 text-xs text-slate-500">上传中 {state.progress}%</p>
                            ) : null}
                            <progress
                              className="h-1.5 w-full accent-blue-700"
                              max={100}
                              value={state?.progress ?? 0}
                              aria-label={`${attachment.name} 上传进度`}
                            />
                            {canManage && (
                              <button
                                type="button"
                                disabled={Boolean(state && !state.error)}
                                onClick={() => void uploadOne(attachment.id)}
                                className="mt-1 rounded-md px-2 py-1 text-xs font-medium text-blue-700 hover:bg-blue-50 disabled:text-slate-300"
                              >
                                {state?.error ? "重试上传" : state ? "正在上传…" : "开始上传"}
                              </button>
                            )}
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          );
        })}
      </div>

      {preview && (
        <div
          className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/70 p-3 sm:p-8"
          role="dialog"
          aria-modal="true"
          aria-label={`预览：${preview.attachment.name}`}
        >
          <div className="flex max-h-full w-full max-w-5xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl">
            <div className="flex items-center justify-between gap-2 border-b border-slate-200 px-4 py-3">
              <p className="min-w-0 truncate text-sm font-medium">{preview.attachment.name}</p>
              <button type="button" onClick={() => setPreview(undefined)} className="px-2 py-1 text-sm text-slate-600">
                关闭
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-auto p-3">
              {preview.text !== undefined ? (
                <pre className="whitespace-pre-wrap break-words text-sm text-slate-800">{preview.text}</pre>
              ) : preview.attachment.mime === "application/pdf" || preview.attachment.ext === "pdf" ? (
                <iframe title={preview.attachment.name} src={preview.url} className="h-[75vh] w-full" />
              ) : preview.attachment.mime.startsWith("image/") ? (
                <img src={preview.url} alt={preview.attachment.name} className="mx-auto max-h-[75vh] max-w-full object-contain" />
              ) : null}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { Attachment, AttachmentRole } from "@/types/attachment";
import { useAppData } from "@/hooks/useAppData";
import { listAll, type AttachmentFilter } from "@/store/attachments";
import { downloadAttachment, fetchAttachmentBlob, getReadUrl } from "@/oss/download";
import {
  canPreview,
  fileIcon,
  formatCategory,
  formatFileSize,
  isTextAttachment
} from "@/features/attachments/attachmentPresentation";
import { showToast } from "@/utils/toast";

const roles: Array<AttachmentRole | "all"> = [
  "all",
  "basis",
  "evidence",
  "reference",
  "draft",
  "other"
];
const roleLabels: Record<AttachmentRole | "all", string> = {
  all: "全部角色",
  basis: "依据",
  evidence: "佐证",
  reference: "参考",
  draft: "草稿",
  other: "其他"
};
const formats: Array<NonNullable<AttachmentFilter["format"]>> = [
  "all",
  "image",
  "pdf",
  "text",
  "office",
  "archive",
  "other"
];
const formatLabels: Record<NonNullable<AttachmentFilter["format"]>, string> = {
  all: "全部格式",
  image: "图片",
  pdf: "PDF",
  text: "文本",
  office: "Office",
  archive: "压缩包",
  other: "其他格式"
};

interface PreviewState {
  attachment: Attachment;
  url?: string;
  text?: string;
}

export function AttachmentLibraryPage() {
  const { data, error: dataError } = useAppData();
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [role, setRole] = useState<AttachmentRole | "all">("all");
  const [format, setFormat] = useState<NonNullable<AttachmentFilter["format"]>>("all");
  const [taskId, setTaskId] = useState("all");
  const [sort, setSort] = useState<NonNullable<AttachmentFilter["sort"]>>("newest");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [loadError, setLoadError] = useState("");
  const [preview, setPreview] = useState<PreviewState>();

  useEffect(() => {
    let active = true;
    const filter: AttachmentFilter = { query, role, format, sort };
    if (taskId !== "all") filter.taskId = taskId;
    listAll(filter)
      .then((result) => {
        if (active) {
          setAttachments(result);
          setLoadError("");
        }
      })
      .catch((error: unknown) => {
        if (active) {
          setLoadError(error instanceof Error ? error.message : "读取附件库失败");
        }
      });
    return () => {
      active = false;
    };
  }, [data?.attachments, query, role, format, taskId, sort]);

  const taskNames = useMemo(() => {
    const names = new Map<string, string>();
    for (const task of data?.tasks ?? []) names.set(task.id, task.title);
    for (const shard of Object.values(data?.archives ?? {})) {
      for (const task of shard.tasks) names.set(task.id, task.title);
    }
    return names;
  }, [data?.tasks, data?.archives]);

  async function openPreview(attachment: Attachment) {
    try {
      if (isTextAttachment(attachment)) {
        const blob = await fetchAttachmentBlob(attachment);
        setPreview({ attachment, text: await blob.text() });
      } else {
        setPreview({ attachment, url: await getReadUrl(attachment.ossKey) });
      }
    } catch (previewError: unknown) {
      showToast(previewError instanceof Error ? previewError.message : "无法预览附件");
    }
  }

  async function download(attachment: Attachment) {
    try {
      const result = await downloadAttachment(attachment);
      showToast(
        result.shaMatches
          ? `已开始下载：${attachment.name}`
          : `下载校验不一致：${attachment.name}，请检查 OSS 文件`
      );
    } catch (downloadError: unknown) {
      showToast(downloadError instanceof Error ? downloadError.message : "附件下载失败");
    }
  }

  if (!data) {
    return <p className="text-sm text-slate-500">正在读取附件库…</p>;
  }

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">附件库</h1>
          <p className="mt-1 text-sm text-slate-500">{attachments.length} 个附件</p>
        </div>
      </div>
      <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <label className="sm:col-span-2 xl:col-span-1">
          <span className="sr-only">搜索附件或任务</span>
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="文件名、备注或任务"
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
        </label>
        <label>
          <span className="sr-only">角色筛选</span>
          <select
            value={role}
            onChange={(event) => setRole(event.target.value as AttachmentRole | "all")}
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
          >
            {roles.map((item) => <option key={item} value={item}>{roleLabels[item]}</option>)}
          </select>
        </label>
        <label>
          <span className="sr-only">格式筛选</span>
          <select
            value={format}
            onChange={(event) =>
              setFormat(event.target.value as NonNullable<AttachmentFilter["format"]>)
            }
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
          >
            {formats.map((item) => <option key={item} value={item}>{formatLabels[item]}</option>)}
          </select>
        </label>
        <label>
          <span className="sr-only">所属任务筛选</span>
          <select
            value={taskId}
            onChange={(event) => setTaskId(event.target.value)}
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
          >
            <option value="all">全部任务</option>
            {Array.from(taskNames, ([id, title]) => (
              <option key={id} value={id}>{title}</option>
            ))}
          </select>
        </label>
        <label>
          <span className="sr-only">排序方式</span>
          <select
            value={sort}
            onChange={(event) =>
              setSort(event.target.value as NonNullable<AttachmentFilter["sort"]>)
            }
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
          >
            <option value="newest">最近上传</option>
            <option value="oldest">最早上传</option>
            <option value="name">文件名</option>
            <option value="size">文件大小</option>
          </select>
        </label>
      </div>
      {(dataError || loadError) && (
        <p className="mt-4 text-sm text-red-700" role="alert">{dataError ?? loadError}</p>
      )}
      <ul className="mt-4 divide-y divide-slate-100">
        {attachments.map((attachment) => (
          <li key={attachment.id} className="flex flex-wrap items-center gap-3 py-3">
            <span className="text-xl" aria-hidden="true">{fileIcon(attachment)}</span>
            <div className="min-w-0 flex-1">
              <p className="break-all text-sm font-medium text-slate-800">{attachment.name}</p>
              <p className="mt-1 text-xs text-slate-500">
                {roleLabels[attachment.role]} · {formatCategory(attachment)} · {formatFileSize(attachment.size)}
                {attachment.note ? ` · ${attachment.note}` : ""}
              </p>
              <button
                type="button"
                onClick={() => navigate(`/task/${attachment.taskId}`)}
                className="mt-1 text-left text-xs text-blue-700 hover:underline"
              >
                所属任务：{taskNames.get(attachment.taskId) ?? "已删除任务"}
              </button>
            </div>
            {canPreview(attachment) && attachment.ossKey && (
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
              disabled={!attachment.ossKey}
              onClick={() => void download(attachment)}
              className="rounded-md px-2 py-1 text-xs text-blue-700 hover:bg-blue-50 disabled:text-slate-300"
            >
              下载
            </button>
          </li>
        ))}
        {attachments.length === 0 && !loadError && (
          <li className="py-12 text-center text-sm text-slate-400">没有符合条件的附件</li>
        )}
      </ul>
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

import type { Attachment } from "@/types/attachment";

const officeExtensions = new Set(["doc", "docx", "xls", "xlsx", "ppt", "pptx"]);
const archiveExtensions = new Set(["zip", "rar", "7z", "tar", "gz"]);
const textExtensions = new Set(["txt", "md", "csv", "json", "xml", "log"]);

export function formatFileSize(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

export function fileIcon(attachment: Attachment): string {
  const ext = attachment.ext.toLowerCase();
  if (attachment.mime.startsWith("image/")) return "🖼";
  if (ext === "pdf") return "📕";
  if (officeExtensions.has(ext)) return "📘";
  if (archiveExtensions.has(ext)) return "🗜";
  if (textExtensions.has(ext) || attachment.mime.startsWith("text/")) return "📄";
  return "📎";
}

export function canPreview(attachment: Attachment): boolean {
  const ext = attachment.ext.toLowerCase();
  return (
    attachment.mime.startsWith("image/") ||
    attachment.mime === "application/pdf" ||
    ext === "pdf" ||
    attachment.mime.startsWith("text/") ||
    textExtensions.has(ext)
  );
}

export function isTextAttachment(attachment: Attachment): boolean {
  return (
    attachment.mime.startsWith("text/") ||
    textExtensions.has(attachment.ext.toLowerCase())
  );
}

export function formatCategory(attachment: Attachment): string {
  const ext = attachment.ext.toLowerCase();
  if (attachment.mime.startsWith("image/")) return "图片";
  if (ext === "pdf" || attachment.mime === "application/pdf") return "PDF";
  if (officeExtensions.has(ext)) return "Office";
  if (archiveExtensions.has(ext)) return "压缩包";
  if (isTextAttachment(attachment)) return "文本";
  return "其他";
}

import { getPendingUploads } from "@/store/pendingUploadsRepository";
import { takeAttachmentPutUrl } from "@/store/presignPoolRepository";
import { markUploaded } from "@/store/attachments";
import { sha256Hex } from "@/utils/hash";
import type { Attachment } from "@/types/attachment";

export type UploadProgress = (percentage: number) => void;

const uploadsInProgress = new Map<string, Promise<Attachment>>();

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

function putWithProgress(
  url: string,
  blob: Blob,
  onProgress: UploadProgress
): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("PUT", url);
    request.withCredentials = false;
    request.setRequestHeader(
      "Content-Type",
      blob.type || "application/octet-stream"
    );
    request.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) {
        onProgress(Math.min(100, Math.round((event.loaded / event.total) * 100)));
      }
    };
    request.onerror = () => reject(new Error("网络中断，附件上传失败"));
    request.onabort = () => reject(new Error("附件上传已取消"));
    request.onload = () => {
      if (request.status >= 200 && request.status < 300) {
        onProgress(100);
        resolve();
      } else {
        reject(
          new Error(
            request.status === 403
              ? "预签名 URL 已失效或 OSS 拒绝访问，请重新生成预签名池"
              : `OSS 上传失败（HTTP ${request.status}）`
          )
        );
      }
    };
    request.send(blob);
  });
}

async function performPendingAttachmentUpload(
  attachmentId: string,
  onProgress: UploadProgress
): Promise<Attachment> {
  const pending = (await getPendingUploads()).find(
    (item) => item.attachment.id === attachmentId
  );
  if (!pending) {
    throw new Error("本地待上传附件不存在，请重新选择文件");
  }
  const contentType = pending.attachment.mime || "application/octet-stream";
  const presign = await takeAttachmentPutUrl(contentType);
  if (!presign) {
    throw new Error("没有可用的 PUT 预签名 URL，请重新生成预签名池");
  }
  if (!presign.key.trim()) {
    throw new Error("PUT 预签名 URL 缺少 OSS 对象 key，请重新生成预签名池");
  }

  const sha256 = await sha256Hex(await pending.blob.arrayBuffer());
  let lastError: Error | undefined;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      onProgress(0);
      const uploadBlob = presign.contentType && presign.contentType !== pending.blob.type
        ? pending.blob.slice(0, pending.blob.size, presign.contentType)
        : pending.blob;
      await putWithProgress(presign.url, uploadBlob, onProgress);
      return await markUploaded(attachmentId, presign.key, sha256);
    } catch (error: unknown) {
      lastError = error instanceof Error ? error : new Error("附件上传失败");
      if (attempt < 3) {
        await wait(400 * (attempt + 1));
      }
    }
  }
  throw new Error(
    lastError?.message ??
      "附件上传失败，请检查网络及预签名 URL 并点击重试"
  );
}

export function uploadPendingAttachment(
  attachmentId: string,
  onProgress: UploadProgress
): Promise<Attachment> {
  const existing = uploadsInProgress.get(attachmentId);
  if (existing) return existing;

  const upload = performPendingAttachmentUpload(attachmentId, onProgress);
  uploadsInProgress.set(attachmentId, upload);
  void upload.then(
    () => uploadsInProgress.delete(attachmentId),
    () => uploadsInProgress.delete(attachmentId)
  );
  return upload;
}

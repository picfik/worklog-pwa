import type { Attachment } from "@/types/attachment";
import { signOssUrl } from "@/oss/ossClient";
import { sha256Hex } from "@/utils/hash";

const OSS_ACCESS_ERROR = "OSS 拒绝访问，请检查 AccessKey 配置与权限";

export async function getReadUrl(key: string): Promise<string> {
  return signOssUrl("GET", key);
}

export async function fetchAttachmentBlob(attachment: Attachment): Promise<Blob> {
  if (!attachment.ossKey) {
    throw new Error("附件尚未上传完成");
  }
  const url = await getReadUrl(attachment.ossKey);
  let response: Response;
  try {
    response = await fetch(url);
  } catch {
    throw new Error("网络中断，无法下载附件");
  }
  if (!response.ok) {
    throw new Error(
      response.status === 403
        ? OSS_ACCESS_ERROR
        : `OSS 下载失败（HTTP ${response.status}）`
    );
  }
  return response.blob();
}

export async function downloadAttachment(
  attachment: Attachment
): Promise<{ shaMatches: boolean }> {
  const blob = await fetchAttachmentBlob(attachment);
  const hash = await sha256Hex(await blob.arrayBuffer());
  const url = URL.createObjectURL(blob);
  try {
    const link = document.createElement("a");
    link.href = url;
    link.download = attachment.name;
    link.rel = "noopener";
    document.body.append(link);
    link.click();
    link.remove();
  } finally {
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return { shaMatches: !attachment.sha256 || hash === attachment.sha256 };
}

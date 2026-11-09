import { getConfig } from "@/store/configRepository";

const URL_TTL_SECONDS = 600;

/**
 * 浏览器端 OSS 即时签名客户端：
 * AccessKey 保存在本机 IndexedDB 的应用配置中，不进入代码仓库；
 * 每次上传/下载前用 Web Crypto 计算 OSS V1 URL 签名，URL 有效期 10 分钟。
 */

function assertKey(value: string | undefined, label: string): string {
  const trimmed = value?.trim();
  if (!trimmed) {
    throw new Error(`尚未配置 OSS ${label}，请前往设置填写`);
  }
  return trimmed;
}

function bucketHost(endpoint: string): string {
  return endpoint.replace(/^https?:\/\//, "").replace(/\/+$/, "");
}

function encodeKeyPath(key: string): string {
  return key.split("/").map(encodeURIComponent).join("/");
}

async function hmacSha1Base64(data: string, secret: string): Promise<string> {
  const encoder = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"]
  );
  const mac = await crypto.subtle.sign("HMAC", cryptoKey, encoder.encode(data));
  let binary = "";
  for (const byte of new Uint8Array(mac)) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

export async function signOssUrl(
  method: "GET" | "PUT",
  key: string,
  contentType?: string
): Promise<string> {
  const config = await getConfig();
  const oss = config?.oss;
  if (!oss) {
    throw new Error("尚未配置 OSS，请先完成首次设置");
  }
  const accessKeyId = assertKey(oss.accessKeyId, "AccessKeyId");
  const accessKeySecret = assertKey(oss.accessKeySecret, "AccessKeySecret");
  const host = bucketHost(assertKey(oss.endpoint, "Endpoint"));
  const bucket = assertKey(oss.bucket, "Bucket");

  const expires = Math.floor(Date.now() / 1000) + URL_TTL_SECONDS;
  const stringToSign = [
    method,
    "",
    contentType ?? "",
    String(expires),
    `/${bucket}/${key}`
  ].join("\n");
  const signature = await hmacSha1Base64(stringToSign, accessKeySecret);
  const query = new URLSearchParams({
    OSSAccessKeyId: accessKeyId,
    Expires: String(expires),
    Signature: signature
  });
  return `https://${host}/${encodeKeyPath(key)}?${query.toString()}`;
}

export function sanitizeFileName(name: string): string {
  const cleaned = name.replace(/[^\w\u4e00-\u9fff.-]+/g, "_").replace(/^_+|_+$/g, "");
  return (cleaned || "file").slice(-80);
}

export function buildAttachmentKey(name: string): string {
  return `worklog/attachments/${crypto.randomUUID()}-${sanitizeFileName(name)}`;
}

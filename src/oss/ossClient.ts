import { getConfig } from "@/store/configRepository";

const URL_TTL_SECONDS = 600;

/**
 * 浏览器端 OSS 即时签名客户端：
 * AccessKey 在 GitHub Actions 构建时通过 secrets 注入（VITE_OSS_* 环境变量），
 * 运行时无需在设置页填写；每次上传/下载前用 Web Crypto 计算 OSS V1 URL 签名。
 */

interface OssCredentials {
  bucket: string;
  endpoint: string;
  accessKeyId: string;
  accessKeySecret: string;
}

const MISSING_KEY_ERROR =
  "OSS AccessKey 未在构建时注入：请在仓库 Actions secrets 配置 OSS_ACCESS_KEY_ID / OSS_ACCESS_KEY_SECRET（及 OSS_BUCKET / OSS_REGION / OSS_ENDPOINT 变量）后重新部署";

function buildCredentials(storedBucket?: string, storedEndpoint?: string): OssCredentials {
  const accessKeyId = import.meta.env.VITE_OSS_ACCESS_KEY_ID?.trim();
  const accessKeySecret = import.meta.env.VITE_OSS_ACCESS_KEY_SECRET?.trim();
  if (!accessKeyId || !accessKeySecret) {
    throw new Error(MISSING_KEY_ERROR);
  }
  const bucket = import.meta.env.VITE_OSS_BUCKET?.trim() || storedBucket?.trim() || "";
  const endpoint = import.meta.env.VITE_OSS_ENDPOINT?.trim() || storedEndpoint?.trim() || "";
  if (!bucket || !endpoint) {
    throw new Error("OSS Bucket/Endpoint 未配置：请在仓库 Actions variables 配置 OSS_BUCKET / OSS_ENDPOINT");
  }
  return { bucket, endpoint, accessKeyId, accessKeySecret };
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
  method: "GET" | "PUT" | "DELETE",
  key: string,
  contentType?: string
): Promise<string> {
  const config = await getConfig();
  const oss = buildCredentials(config?.oss.bucket, config?.oss.endpoint);

  const expires = Math.floor(Date.now() / 1000) + URL_TTL_SECONDS;
  const stringToSign = [
    method,
    "",
    contentType ?? "",
    String(expires),
    `/${oss.bucket}/${key}`
  ].join("\n");
  const signature = await hmacSha1Base64(stringToSign, oss.accessKeySecret);
  const query = new URLSearchParams({
    OSSAccessKeyId: oss.accessKeyId,
    Expires: String(expires),
    Signature: signature
  });
  return `https://${oss.bucket}.${bucketHost(oss.endpoint)}/${encodeKeyPath(key)}?${query.toString()}`;
}

export function sanitizeFileName(name: string): string {
  const cleaned = name.replace(/[^\w\u4e00-\u9fff.-]+/g, "_").replace(/^_+|_+$/g, "");
  return (cleaned || "file").slice(-80);
}

export function buildAttachmentKey(name: string): string {
  return `worklog/attachments/${crypto.randomUUID()}-${sanitizeFileName(name)}`;
}

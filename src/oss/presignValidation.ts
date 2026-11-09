import type { PresignedUrl } from "@/types/storage";

function isPresignedUrl(value: unknown): value is PresignedUrl {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    (candidate.type === "put" || candidate.type === "get") &&
    typeof candidate.url === "string" &&
    (candidate.url.startsWith("https://") || candidate.url.startsWith("http://")) &&
    typeof candidate.key === "string" &&
    candidate.key.trim().length > 0 &&
    typeof candidate.expiresAt === "string" &&
    Number.isFinite(Date.parse(candidate.expiresAt)) &&
    (candidate.contentType === undefined || typeof candidate.contentType === "string")
  );
}

export function parsePresignedUrls(input: string): PresignedUrl[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(input || "[]");
  } catch {
    throw new Error("预签名 URL 池不是有效的 JSON");
  }
  if (!Array.isArray(parsed)) {
    throw new Error("预签名 URL 必须是 [{type,url,key,expiresAt}] 格式的数组");
  }
  const entries: unknown[] = parsed;
  const urls: PresignedUrl[] = [];
  for (const entry of entries) {
    if (!isPresignedUrl(entry)) {
      throw new Error("预签名 URL 必须是 [{type,url,key,expiresAt}] 格式的数组");
    }
    urls.push(entry);
  }
  return urls;
}

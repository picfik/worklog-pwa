import type { PresignedUrl, StoredPresignedUrl } from "@/types/storage";
import { getDatabase } from "@/store/db";

export async function getPresignPool(): Promise<StoredPresignedUrl[]> {
  const database = await getDatabase();
  const transaction = database.transaction("presignPool", "readonly");
  const store = transaction.objectStore("presignPool");
  const keys = await store.getAllKeys();
  const entries = await store.getAll();
  await transaction.done;
  return entries.map((entry, index) => ({ ...entry, id: Number(keys[index]) }));
}

export async function addPresignUrls(list: PresignedUrl[]): Promise<void> {
  const database = await getDatabase();
  const transaction = database.transaction("presignPool", "readwrite");
  for (const entry of list) {
    await transaction.store.add(entry);
  }
  await transaction.done;
}

export async function takePresignUrl(
  type: PresignedUrl["type"],
  key?: string,
  contentType?: string
): Promise<StoredPresignedUrl | undefined> {
  return takeMatchingUrl((entry) =>
    entry.type === type &&
    (key === undefined || entry.key === key) &&
    (contentType === undefined || entry.contentType === undefined || entry.contentType === contentType)
  );
}

export async function takeAttachmentPutUrl(
  contentType: string
): Promise<StoredPresignedUrl | undefined> {
  const isAttachmentKey = (entry: PresignedUrl) =>
    entry.type === "put" &&
    entry.key.trim().length > 0 &&
    !/^worklog\/(manifest|tasks|attachments|status_history|devices)\.json$/.test(entry.key) &&
    !/^worklog\/archive\/\d{4}-\d{2}\.json$/.test(entry.key);
  const exact = await takeMatchingUrl((entry) =>
    isAttachmentKey(entry) && entry.contentType === contentType
  );
  if (exact) return exact;
  return takeMatchingUrl((entry) => isAttachmentKey(entry) && entry.contentType === undefined);
}

async function takeMatchingUrl(
  matches: (entry: PresignedUrl) => boolean
): Promise<StoredPresignedUrl | undefined> {
  const database = await getDatabase();
  const transaction = database.transaction("presignPool", "readwrite");
  let cursor = await transaction.store.openCursor();
  const now = Date.now();
  while (cursor) {
    const expiresAt = Date.parse(cursor.value.expiresAt);
    if (
      matches(cursor.value) &&
      Number.isFinite(expiresAt) &&
      expiresAt > now
    ) {
      const selected: StoredPresignedUrl = {
        ...cursor.value,
        id: Number(cursor.key)
      };
      await cursor.delete();
      await transaction.done;
      return selected;
    }
    cursor = await cursor.continue();
  }
  await transaction.done;
  return undefined;
}

export async function clearPresignPool(): Promise<void> {
  const database = await getDatabase();
  await database.clear("presignPool");
}

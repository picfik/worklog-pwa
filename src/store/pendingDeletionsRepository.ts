import type { PendingDeletion } from "@/types/storage";
import { getDatabase } from "@/store/db";

export async function addPendingDeletion(key: string): Promise<void> {
  const trimmed = key.trim();
  if (!trimmed) return;
  const database = await getDatabase();
  const existing = await database.get("pendingDeletions", trimmed);
  if (existing) return;
  await database.put(
    "pendingDeletions",
    { key: trimmed, createdAt: new Date().toISOString() },
    trimmed
  );
}

export async function getPendingDeletions(): Promise<PendingDeletion[]> {
  const database = await getDatabase();
  return database.getAll("pendingDeletions");
}

export async function removePendingDeletion(key: string): Promise<void> {
  const database = await getDatabase();
  await database.delete("pendingDeletions", key);
}

export async function clearPendingDeletions(): Promise<void> {
  const database = await getDatabase();
  await database.clear("pendingDeletions");
}

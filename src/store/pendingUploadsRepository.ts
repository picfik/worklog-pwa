import type { PendingUpload } from "@/types/storage";
import { getDatabase } from "@/store/db";

export async function addPendingUpload(upload: PendingUpload): Promise<number> {
  const database = await getDatabase();
  return database.add("pendingUploads", {
    ...upload,
    createdAt: upload.createdAt ?? new Date().toISOString()
  });
}

export async function getPendingUploads(): Promise<PendingUpload[]> {
  const database = await getDatabase();
  const transaction = database.transaction("pendingUploads", "readonly");
  const [keys, entries] = await Promise.all([
    transaction.store.getAllKeys(),
    transaction.store.getAll()
  ]);
  await transaction.done;
  return entries.map((entry, index) => ({ ...entry, id: Number(keys[index]) }));
}

export async function removePendingUpload(id: number): Promise<void> {
  const database = await getDatabase();
  await database.delete("pendingUploads", id);
}

export async function clearPendingUploads(): Promise<void> {
  const database = await getDatabase();
  await database.clear("pendingUploads");
}

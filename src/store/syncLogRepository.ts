import type { SyncLogEntry } from "@/types/storage";
import { getDatabase } from "@/store/db";

export async function addSyncLog(entry: SyncLogEntry): Promise<number> {
  const database = await getDatabase();
  return database.add("syncLog", entry);
}

export async function getSyncLog(): Promise<SyncLogEntry[]> {
  const database = await getDatabase();
  return database.getAll("syncLog");
}

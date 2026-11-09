import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type {
  AppConfig,
  LocalData,
  PendingUpload,
  PresignedUrl,
  SyncLogEntry
} from "@/types/storage";

interface WorklogDatabase extends DBSchema {
  data: {
    key: string;
    value: LocalData;
  };
  config: {
    key: string;
    value: AppConfig;
  };
  presignPool: {
    key: number;
    value: PresignedUrl;
  };
  pendingUploads: {
    key: number;
    value: PendingUpload;
  };
  syncLog: {
    key: number;
    value: SyncLogEntry;
  };
}

let databasePromise: Promise<IDBPDatabase<WorklogDatabase>> | undefined;

export function getDatabase(): Promise<IDBPDatabase<WorklogDatabase>> {
  databasePromise ??= openDB<WorklogDatabase>("worklog-pwa", 1, {
    upgrade(database) {
      database.createObjectStore("data");
      database.createObjectStore("config");
      database.createObjectStore("presignPool", { autoIncrement: true });
      database.createObjectStore("pendingUploads", { autoIncrement: true });
      database.createObjectStore("syncLog", { autoIncrement: true });
    }
  });
  return databasePromise;
}

export type { WorklogDatabase };

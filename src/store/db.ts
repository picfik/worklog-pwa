import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type {
  AppConfig,
  LocalData,
  PendingDeletion,
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
  pendingDeletions: {
    key: string;
    value: PendingDeletion;
  };
  syncLog: {
    key: number;
    value: SyncLogEntry;
  };
}

let databasePromise: Promise<IDBPDatabase<WorklogDatabase>> | undefined;

export function getDatabase(): Promise<IDBPDatabase<WorklogDatabase>> {
  databasePromise ??= openDB<WorklogDatabase>("worklog-pwa", 2, {
    upgrade(database, oldVersion) {
      if (oldVersion < 1) {
        database.createObjectStore("data");
        database.createObjectStore("config");
        database.createObjectStore("presignPool", { autoIncrement: true });
        database.createObjectStore("pendingUploads", { autoIncrement: true });
        database.createObjectStore("syncLog", { autoIncrement: true });
      }
      if (oldVersion < 2) {
        database.createObjectStore("pendingDeletions");
      }
    }
  });
  return databasePromise;
}

export type { WorklogDatabase };

import type { Attachment } from "@/types/attachment";
import type { ArchiveShard } from "@/types/archive";
import type { Device } from "@/types/device";
import type { HistoryEvent } from "@/types/history";
import type { Manifest } from "@/types/manifest";
import type { Task } from "@/types/task";

export interface LocalData {
  manifest: Manifest;
  tasks: Task[];
  attachments: Attachment[];
  statusHistory: HistoryEvent[];
  devices: Device[];
  archives: Record<string, ArchiveShard>;
  dirty: boolean;
  lastRemoteVersion: number;
}

export interface OssConfig {
  bucket: string;
  region: string;
  endpoint: string;
}

export interface AppConfig {
  deviceId: string;
  deviceName: string;
  oss: OssConfig;
}

export interface PresignedUrl {
  type: "put" | "get";
  url: string;
  key: string;
  expiresAt: string;
  contentType?: string;
}

export interface StoredPresignedUrl extends PresignedUrl {
  id: number;
}

export interface PendingUpload {
  id?: number;
  blob: Blob;
  attachment: Attachment;
  createdAt?: string;
}

export interface SyncLogEntry {
  id?: number;
  at: string;
  action: string;
  success: boolean;
  message?: string;
}

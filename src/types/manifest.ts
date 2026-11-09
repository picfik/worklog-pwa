export type ShardName =
  | "tasks"
  | "attachments"
  | "status_history"
  | "devices"
  | `archive/${string}`;

export interface ShardMetadata {
  sha256: string;
  count: number;
}

export interface Manifest {
  version: number;
  lastWriterDeviceId?: string;
  lastSyncAt?: string;
  shards: Partial<Record<ShardName, ShardMetadata>>;
}

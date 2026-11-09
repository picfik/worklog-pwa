import type { ArchiveShard } from "@/types/archive";
import type { Attachment } from "@/types/attachment";
import type { Device } from "@/types/device";
import type { HistoryEvent } from "@/types/history";
import type { Manifest, ShardName, ShardMetadata } from "@/types/manifest";
import type { Task } from "@/types/task";
import type { LocalData } from "@/types/storage";
import { sha256Hex } from "@/utils/hash";

export interface SerializedShard {
  content: string;
  metadata: ShardMetadata;
}

export type SerializedShards = Partial<Record<ShardName, SerializedShard>>;

export interface DeserializedShards {
  tasks: Task[];
  attachments: Attachment[];
  statusHistory: HistoryEvent[];
  devices: Device[];
  archives: Record<string, ArchiveShard>;
}

export interface ShardDiff {
  upload: ShardName[];
  download: ShardName[];
}

const BASE_SHARDS: ShardName[] = [
  "tasks",
  "attachments",
  "status_history",
  "devices"
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isTask(value: unknown): value is Task {
  return isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.title === "string" &&
    ["todo", "doing", "done", "archived"].includes(String(value.status)) &&
    typeof value.basisText === "string" &&
    (typeof value.deadline === "string" || value.deadline === null) &&
    typeof value.notes === "string" &&
    typeof value.createdAt === "string" &&
    typeof value.updatedAt === "string" &&
    typeof value.incomplete === "boolean";
}

function isAttachment(value: unknown): value is Attachment {
  return isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.taskId === "string" &&
    ["basis", "evidence", "reference", "draft", "other"].includes(String(value.role)) &&
    typeof value.name === "string" &&
    typeof value.mime === "string" &&
    typeof value.ext === "string" &&
    typeof value.size === "number" &&
    typeof value.sha256 === "string" &&
    typeof value.ossKey === "string" &&
    typeof value.uploadedAt === "string";
}

function isHistoryEvent(value: unknown): value is HistoryEvent {
  return isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.taskId === "string" &&
    typeof value.eventType === "string" &&
    typeof value.at === "string" &&
    typeof value.deviceId === "string";
}

function isDevice(value: unknown): value is Device {
  return isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.name === "string" &&
    typeof value.lastSeenAt === "string";
}

function parseArray<T>(
  content: string,
  shardName: string,
  isItem: (value: unknown) => value is T
): T[] {
  let value: unknown;
  try {
    value = JSON.parse(content);
  } catch {
    throw new Error(`远端分片 ${shardName} 不是有效 JSON`);
  }
  if (!Array.isArray(value) || !value.every(isItem)) {
    throw new Error(`远端分片 ${shardName} 的数据结构无效`);
  }
  return value;
}

function countItems(name: ShardName, value: unknown): number {
  if (name.startsWith("archive/") && isRecord(value)) {
    const tasks = Array.isArray(value.tasks) ? value.tasks.length : 0;
    const events = Array.isArray(value.historyEvents) ? value.historyEvents.length : 0;
    return tasks + events;
  }
  return Array.isArray(value) ? value.length : 0;
}

function addSerialized(
  output: SerializedShards,
  name: ShardName,
  value: unknown
): void {
  output[name] = {
    content: JSON.stringify(value),
    metadata: { sha256: "", count: countItems(name, value) }
  };
}

export async function serializeShards(data: LocalData): Promise<SerializedShards> {
  const output: SerializedShards = {};
  addSerialized(output, "tasks", data.tasks);
  addSerialized(output, "attachments", data.attachments);
  addSerialized(output, "status_history", data.statusHistory);
  addSerialized(output, "devices", data.devices);
  for (const [month, archive] of Object.entries(data.archives)) {
    if (!/^\d{4}-\d{2}$/.test(month) || archive.month !== month) {
      throw new Error(`归档分片月份无效：${month}`);
    }
    addSerialized(output, `archive/${month}`, archive);
  }
  await Promise.all(
    Object.values(output).map(async (shard) => {
      if (shard) {
        shard.metadata.sha256 = await sha256Hex(new TextEncoder().encode(shard.content).buffer);
      }
    })
  );
  return output;
}

export function shardObjectKey(name: ShardName): string {
  return `worklog/${name}.json`;
}

export function manifestToMetadata(
  shards: SerializedShards
): Manifest["shards"] {
  return Object.fromEntries(
    Object.entries(shards).flatMap(([name, shard]) =>
      shard ? [[name, shard.metadata]] : []
    )
  ) as Manifest["shards"];
}

export function diffShards(local: Manifest, remote: Manifest): ShardDiff {
  const names = new Set<ShardName>([
    ...BASE_SHARDS,
    ...Object.keys(local.shards) as ShardName[],
    ...Object.keys(remote.shards) as ShardName[]
  ]);
  const upload: ShardName[] = [];
  const download: ShardName[] = [];
  for (const name of names) {
    const localShard = local.shards[name];
    const remoteShard = remote.shards[name];
    if (localShard?.sha256 === remoteShard?.sha256) continue;
    if (localShard) upload.push(name);
    if (remoteShard) download.push(name);
  }
  return { upload, download };
}

export function deserializeShards(
  shards: Partial<Record<ShardName, string>>
): DeserializedShards {
  const tasks = shards.tasks === undefined
    ? []
    : parseArray(shards.tasks, "tasks", isTask);
  const attachments = shards.attachments === undefined
    ? []
    : parseArray(shards.attachments, "attachments", isAttachment);
  const statusHistory = shards.status_history === undefined
    ? []
    : parseArray(shards.status_history, "status_history", isHistoryEvent);
  const devices = shards.devices === undefined
    ? []
    : parseArray(shards.devices, "devices", isDevice);
  const archives: Record<string, ArchiveShard> = {};

  for (const [name, content] of Object.entries(shards)) {
    if (!name.startsWith("archive/") || content === undefined) continue;
    const month = name.slice("archive/".length);
    let value: unknown;
    try {
      value = JSON.parse(content);
    } catch {
      throw new Error(`远端分片 ${name} 不是有效 JSON`);
    }
    if (
      !isRecord(value) ||
      value.month !== month ||
      !Array.isArray(value.tasks) ||
      !value.tasks.every(isTask) ||
      !Array.isArray(value.historyEvents) ||
      !value.historyEvents.every(isHistoryEvent)
    ) {
      throw new Error(`远端分片 ${name} 的数据结构无效`);
    }
    archives[month] = value as unknown as ArchiveShard;
  }

  return { tasks, attachments, statusHistory, devices, archives };
}

export function manifestFromUnknown(value: unknown): Manifest {
  if (!isRecord(value) || !Number.isInteger(value.version) || !isRecord(value.shards)) {
    throw new Error("远端 manifest.json 数据结构无效");
  }
  const shards: Manifest["shards"] = {};
  for (const [name, metadata] of Object.entries(value.shards)) {
    if (
      !/^(tasks|attachments|status_history|devices|archive\/\d{4}-\d{2})$/.test(name) ||
      !isRecord(metadata) ||
      typeof metadata.sha256 !== "string" ||
      !Number.isInteger(metadata.count)
    ) {
      throw new Error(`远端 manifest.json 分片信息无效：${name}`);
    }
    shards[name as ShardName] = {
      sha256: metadata.sha256,
      count: metadata.count as number
    };
  }
  return {
    version: value.version as number,
    lastWriterDeviceId:
      typeof value.lastWriterDeviceId === "string" ? value.lastWriterDeviceId : "",
    lastSyncAt: typeof value.lastSyncAt === "string" ? value.lastSyncAt : "",
    shards
  };
}

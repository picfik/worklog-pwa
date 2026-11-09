import type { Manifest, ShardName } from "@/types/manifest";
import type { AppConfig, LocalData, SyncLogEntry } from "@/types/storage";
import { getConfig } from "@/store/configRepository";
import {
  getDirtyRevision,
  loadData,
  saveData
} from "@/store/dataRepository";
import { getPendingUploads } from "@/store/pendingUploadsRepository";
import { takePresignUrl } from "@/store/presignPoolRepository";
import { addSyncLog, getSyncLog } from "@/store/syncLogRepository";
import {
  deserializeShards,
  diffShards,
  manifestFromUnknown,
  manifestToMetadata,
  serializeShards,
  shardObjectKey,
  type SerializedShards
} from "@/store/shards";
import { uploadPendingAttachment } from "@/oss/upload";
import { sha256Hex } from "@/utils/hash";

export type ConflictChoice = "overwrite-remote" | "use-remote";
export type SyncDecision = "push" | "pull" | "conflict" | "noop";
export type SyncState = "idle" | "syncing" | "synced" | "dirty" | "failed" | "conflict";

export interface SyncStatus {
  state: SyncState;
  localVersion: number;
  remoteVersion: number;
  pendingCount: number;
  lastSyncAt: string;
  error?: string;
}

export interface SyncOutcome {
  result: "pushed" | "pulled" | "noop" | "conflict";
  status: SyncStatus;
}

const MANIFEST_KEY = "worklog/manifest.json";
const EMPTY_MANIFEST: Manifest = {
  version: 0,
  lastWriterDeviceId: "",
  lastSyncAt: "",
  shards: {}
};

let syncStatus: SyncStatus = {
  state: "idle",
  localVersion: 0,
  remoteVersion: 0,
  pendingCount: 0,
  lastSyncAt: ""
};
let activeSync: Promise<SyncOutcome> | undefined;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "同步失败，请检查网络及预签名 URL";
}

function publishStatus(status: SyncStatus): void {
  syncStatus = status;
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent<SyncStatus>("worklog:sync-status", { detail: status }));
  }
}

export function getSyncStatus(): SyncStatus {
  return syncStatus;
}

export async function refreshSyncStatus(): Promise<SyncStatus> {
  const data = await loadData();
  const state: SyncState = data.dirty
    ? syncStatus.state === "failed" ? "failed" : "dirty"
    : syncStatus.state === "failed" ? "failed" : "synced";
  const status = await getStatus(
    state,
    data,
    data.lastRemoteVersion,
    state === "failed" ? syncStatus.error : undefined
  );
  publishStatus(status);
  return status;
}

export function decideSync(local: LocalData, remoteManifest: Manifest): SyncDecision {
  if (!local.dirty && remoteManifest.version > local.manifest.version) {
    return "pull";
  }
  if (local.dirty && remoteManifest.version === local.manifest.version) {
    return "push";
  }
  if (local.dirty && remoteManifest.version > local.manifest.version) {
    return "conflict";
  }
  return "noop";
}

async function countPendingChanges(data: LocalData, pendingUploadCount: number): Promise<number> {
  const serialized = await serializeShards(data);
  let changedCount = pendingUploadCount;
  for (const [name, shard] of Object.entries(serialized) as Array<
    [ShardName, NonNullable<SerializedShards[ShardName]>]
  >) {
    if (data.manifest.shards[name]?.sha256 !== shard.metadata.sha256) {
      changedCount += shard.metadata.count;
    }
  }
  return data.dirty ? Math.max(1, changedCount) : 0;
}

async function getStatus(
  state: SyncState,
  local: LocalData,
  remoteVersion = local.lastRemoteVersion,
  error?: string
): Promise<SyncStatus> {
  const pending = await getPendingUploads();
  return {
    state,
    localVersion: local.manifest.version,
    remoteVersion,
    pendingCount: await countPendingChanges(local, pending.length),
    lastSyncAt: local.manifest.lastSyncAt ?? "",
    ...(error === undefined ? {} : { error })
  };
}

async function logSync(action: string, success: boolean, message?: string): Promise<void> {
  const entry: SyncLogEntry = {
    at: new Date().toISOString(),
    action,
    success,
    ...(message === undefined ? {} : { message })
  };
  await addSyncLog(entry);
}

async function readManifest(): Promise<Manifest> {
  const presign = await takePresignUrl("get", MANIFEST_KEY);
  if (!presign) {
    throw new Error("没有匹配且未过期的 manifest GET 预签名 URL，请重新生成预签名池");
  }
  let response: Response;
  try {
    response = await fetch(presign.url);
  } catch {
    throw new Error("网络中断，无法读取远端 manifest");
  }
  if (response.status === 404) {
    return EMPTY_MANIFEST;
  }
  if (!response.ok) {
    throw new Error(
      response.status === 403
        ? "manifest GET 预签名 URL 已失效，请重新生成预签名池"
        : `读取远端 manifest 失败（HTTP ${response.status}）`
    );
  }
  let value: unknown;
  try {
    value = await response.json();
  } catch {
    throw new Error("远端 manifest.json 不是有效 JSON");
  }
  return manifestFromUnknown(value);
}

async function putObject(key: string, content: string): Promise<void> {
  const presign = await takePresignUrl("put", key, "application/json");
  if (!presign) {
    throw new Error(`没有匹配且未过期的 PUT 预签名 URL（${key}），请重新生成预签名池`);
  }
  let response: Response;
  try {
    response = await fetch(presign.url, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: content
    });
  } catch {
    throw new Error(`网络中断，无法上传 ${key}`);
  }
  if (!response.ok) {
    throw new Error(
      response.status === 403
        ? `${key} 的 PUT 预签名 URL 已失效，请重新生成预签名池`
        : `上传 ${key} 失败（HTTP ${response.status}）`
    );
  }
}

async function getObject(name: ShardName, expectedHash: string): Promise<string> {
  const key = shardObjectKey(name);
  const presign = await takePresignUrl("get", key);
  if (!presign) {
    throw new Error(`没有匹配且未过期的 GET 预签名 URL（${key}），请重新生成预签名池`);
  }
  let response: Response;
  try {
    response = await fetch(presign.url);
  } catch {
    throw new Error(`网络中断，无法下载 ${key}`);
  }
  if (!response.ok) {
    throw new Error(
      response.status === 403
        ? `${key} 的 GET 预签名 URL 已失效，请重新生成预签名池`
        : `下载 ${key} 失败（HTTP ${response.status}）`
    );
  }
  const content = await response.text();
  const hash = await sha256Hex(new TextEncoder().encode(content).buffer as ArrayBuffer);
  if (hash !== expectedHash) {
    throw new Error(`远端分片 ${key} 的 SHA-256 校验失败`);
  }
  return content;
}

async function pushData(
  data: LocalData,
  remoteManifest: Manifest,
  config: AppConfig
): Promise<void> {
  const pending = await getPendingUploads();
  for (const upload of pending) {
    await uploadPendingAttachment(upload.attachment.id, () => undefined);
  }

  const revisionAtSnapshot = getDirtyRevision();
  const serialized = await serializeShards(data);
  const changedShards: ShardName[] = [];
  for (const [name, shard] of Object.entries(serialized) as Array<
    [ShardName, NonNullable<SerializedShards[ShardName]>]
  >) {
    if (remoteManifest.shards[name]?.sha256 !== shard.metadata.sha256) {
      changedShards.push(name);
    }
  }

  for (const name of changedShards) {
    const shard = serialized[name];
    if (!shard) {
      throw new Error(`本地分片 ${name} 序列化失败`);
    }
    await putObject(shardObjectKey(name), shard.content);
  }

  const nextManifest: Manifest = {
    version: remoteManifest.version + 1,
    lastWriterDeviceId: config.deviceId,
    lastSyncAt: new Date().toISOString(),
    shards: manifestToMetadata(serialized)
  };
  await putObject(MANIFEST_KEY, JSON.stringify(nextManifest));

  data.manifest = nextManifest;
  data.lastRemoteVersion = nextManifest.version;
  data.dirty = revisionAtSnapshot !== getDirtyRevision();
  await saveData(data);
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event("worklog:data-refreshed"));
  }
}

async function pullData(
  data: LocalData,
  remoteManifest: Manifest,
  config: AppConfig
): Promise<void> {
  const localSerialized = await serializeShards(data);
  const shardContents: Partial<Record<ShardName, string>> = {};
  for (const [name, shard] of Object.entries(localSerialized) as Array<
    [ShardName, NonNullable<SerializedShards[ShardName]>]
  >) {
    shardContents[name] = shard.content;
  }

  const remoteNames = new Set(Object.keys(remoteManifest.shards) as ShardName[]);
  for (const name of Object.keys(shardContents) as ShardName[]) {
    if (!remoteNames.has(name)) {
      delete shardContents[name];
    }
  }

  const changes = diffShards(data.manifest, remoteManifest);
  for (const name of changes.download) {
    const metadata = remoteManifest.shards[name];
    if (!metadata) continue;
    shardContents[name] = await getObject(name, metadata.sha256);
  }

  const pulled = deserializeShards(shardContents);
  const currentDevice = {
    id: config.deviceId,
    name: config.deviceName,
    lastSeenAt: new Date().toISOString()
  };
  const devices = [
    ...pulled.devices.filter((device) => device.id !== currentDevice.id),
    currentDevice
  ];
  data.tasks = pulled.tasks;
  data.attachments = pulled.attachments;
  data.statusHistory = pulled.statusHistory;
  data.devices = devices;
  data.archives = pulled.archives;
  data.manifest = remoteManifest;
  data.lastRemoteVersion = remoteManifest.version;
  data.dirty = false;
  await saveData(data);
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event("worklog:data-refreshed"));
  }
}

async function performSync(choice?: ConflictChoice): Promise<SyncOutcome> {
  const [data, config] = await Promise.all([loadData(), getConfig()]);
  if (!config?.deviceId) {
    throw new Error("尚未设置设备，请先完成设备初始化");
  }
  publishStatus(await getStatus("syncing", data));
  const remoteManifest = await readManifest();
  data.lastRemoteVersion = remoteManifest.version;
  const decision = decideSync(data, remoteManifest);

  if (decision === "conflict" && choice === undefined) {
    const status = await getStatus("conflict", data, remoteManifest.version);
    publishStatus(status);
    await logSync("conflict", false, `本地版本 ${data.manifest.version}，远端版本 ${remoteManifest.version}`);
    return { result: "conflict", status };
  }

  if (decision === "pull" || (decision === "conflict" && choice === "use-remote")) {
    await pullData(data, remoteManifest, config);
    await logSync("pull", true, `已拉取远端版本 ${remoteManifest.version}`);
    const status = await getStatus("synced", data, remoteManifest.version);
    publishStatus(status);
    return { result: "pulled", status };
  }

  if (decision === "push" || (decision === "conflict" && choice === "overwrite-remote")) {
    await pushData(data, remoteManifest, config);
    await logSync("push", true, `已推送版本 ${data.manifest.version}`);
    const status = await getStatus(data.dirty ? "dirty" : "synced", data, data.manifest.version);
    publishStatus(status);
    return { result: "pushed", status };
  }

  if (decision === "noop") {
    if (remoteManifest.version === data.manifest.version && data.lastRemoteVersion !== remoteManifest.version) {
      data.lastRemoteVersion = remoteManifest.version;
      await saveData(data);
    }
    const status = await getStatus(data.dirty ? "dirty" : "synced", data, remoteManifest.version);
    publishStatus(status);
    return { result: "noop", status };
  }

  const status = await getStatus("conflict", data, remoteManifest.version);
  publishStatus(status);
  return { result: "conflict", status };
}

export async function synchronize(choice?: ConflictChoice): Promise<SyncOutcome> {
  if (activeSync) {
    return activeSync;
  }
  const running = performSync(choice)
    .catch(async (error: unknown) => {
      const data = await loadData();
      const message = errorMessage(error);
      await logSync("sync", false, message);
      const status = await getStatus("failed", data, data.lastRemoteVersion, message);
      publishStatus(status);
      return { result: "noop" as const, status };
    })
    .finally(() => {
      activeSync = undefined;
    });
  activeSync = running;
  return running;
}

export async function bootstrapSync(): Promise<{ recovered: boolean; outcome: SyncOutcome }> {
  if (activeSync) {
    const outcome = await activeSync;
    return { recovered: outcome.result === "pulled", outcome };
  }
  let recovered = false;
  const running = (async (): Promise<SyncOutcome> => {
    const [data, config] = await Promise.all([loadData(), getConfig()]);
    if (!config?.deviceId) {
      throw new Error("尚未设置设备，请先完成设备初始化");
    }
    publishStatus(await getStatus("syncing", data));
    const remoteManifest = await readManifest();
    await pullData(data, remoteManifest, config);
    recovered = remoteManifest.version > 0;
    await logSync("initial-pull", true, `已完成版本 ${remoteManifest.version} 的启动拉取`);
    const status = await getStatus("synced", data, remoteManifest.version);
    publishStatus(status);
    return { result: "pulled", status } satisfies SyncOutcome;
  })()
    .catch(async (error: unknown) => {
      const data = await loadData();
      const message = errorMessage(error);
      await logSync("initial-pull", false, message);
      const status = await getStatus("failed", data, data.lastRemoteVersion, message);
      publishStatus(status);
      throw error;
    })
    .finally(() => {
      activeSync = undefined;
    });
  activeSync = running;
  const outcome = await running;
  return { recovered, outcome };
}

export async function getRecentSyncLog(): Promise<SyncLogEntry[]> {
  return (await getSyncLog())
    .sort((left, right) => Date.parse(right.at) - Date.parse(left.at))
    .slice(0, 20);
}

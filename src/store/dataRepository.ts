import type { LocalData } from "@/types/storage";
import { getDatabase } from "@/store/db";

const DATA_KEY = "current";
const SAVE_DEBOUNCE_MS = 800;
let cachedData: LocalData | undefined;
let loadPromise: Promise<LocalData> | undefined;
let saveTimer: ReturnType<typeof setTimeout> | undefined;
let dirtyRevision = 0;

export function createEmptyData(): LocalData {
  return {
    manifest: { version: 0, shards: {} },
    tasks: [],
    attachments: [],
    statusHistory: [],
    devices: [],
    archives: {},
    dirty: false,
    lastRemoteVersion: 0
  };
}

export async function loadData(): Promise<LocalData> {
  if (cachedData) {
    return cachedData;
  }
  loadPromise ??= (async () => {
    const database = await getDatabase();
    cachedData = (await database.get("data", DATA_KEY)) ?? createEmptyData();
    return cachedData;
  })().finally(() => {
    loadPromise = undefined;
  });
  return loadPromise;
}

export async function saveData(data: LocalData): Promise<void> {
  const database = await getDatabase();
  await database.put("data", data, DATA_KEY);
  cachedData = data;
}

export async function markDirty(): Promise<void> {
  const data = await loadData();
  dirtyRevision += 1;
  data.dirty = true;
  if (saveTimer !== undefined) {
    clearTimeout(saveTimer);
  }
  saveTimer = setTimeout(() => {
    saveTimer = undefined;
    void saveData(data).catch((error: unknown) => {
      console.error("保存本地留痕数据失败", error);
    });
  }, SAVE_DEBOUNCE_MS);
}

export function getDirtyRevision(): number {
  return dirtyRevision;
}

export async function hasStoredData(): Promise<boolean> {
  const database = await getDatabase();
  return (await database.get("data", DATA_KEY)) !== undefined;
}

export async function clearStoredData(): Promise<void> {
  if (saveTimer !== undefined) {
    clearTimeout(saveTimer);
    saveTimer = undefined;
  }
  cachedData = undefined;
  dirtyRevision = 0;
  const database = await getDatabase();
  await database.delete("data", DATA_KEY);
}

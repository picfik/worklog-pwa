import type { AppConfig } from "@/types/storage";
import { getDatabase } from "@/store/db";

const CONFIG_KEY = "app";

export async function getConfig(): Promise<AppConfig | undefined> {
  const database = await getDatabase();
  return database.get("config", CONFIG_KEY);
}

export async function setConfig(config: AppConfig): Promise<void> {
  const database = await getDatabase();
  await database.put("config", config, CONFIG_KEY);
}

export async function clearConfig(): Promise<void> {
  const database = await getDatabase();
  await database.delete("config", CONFIG_KEY);
}

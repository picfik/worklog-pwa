import { clearConfig } from "@/store/configRepository";
import { clearStoredData } from "@/store/dataRepository";
import { getDatabase } from "@/store/db";
import { clearPendingUploads } from "@/store/pendingUploadsRepository";

export async function clearConfigurationAndData(): Promise<void> {
  const database = await getDatabase();
  await Promise.all([
    clearConfig(),
    clearStoredData(),
    database.clear("presignPool"),
    clearPendingUploads()
  ]);
}

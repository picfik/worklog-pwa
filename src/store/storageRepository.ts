import { clearConfig } from "@/store/configRepository";
import { clearStoredData } from "@/store/dataRepository";
import { clearPresignPool } from "@/store/presignPoolRepository";
import { clearPendingUploads } from "@/store/pendingUploadsRepository";

export async function clearConfigurationAndData(): Promise<void> {
  await Promise.all([
    clearConfig(),
    clearStoredData(),
    clearPresignPool(),
    clearPendingUploads()
  ]);
}

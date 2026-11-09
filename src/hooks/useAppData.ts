import { useCallback, useEffect, useState } from "react";
import type { LocalData } from "@/types/storage";
import { loadData } from "@/store/dataRepository";

interface AppDataState {
  data?: LocalData;
  error?: string;
}

function snapshot(data: LocalData): LocalData {
  return {
    ...data,
    tasks: [...data.tasks],
    attachments: [...data.attachments],
    statusHistory: [...data.statusHistory],
    devices: [...data.devices],
    archives: { ...data.archives }
  };
}

export function useAppData(): AppDataState & { refresh: () => Promise<void> } {
  const [state, setState] = useState<AppDataState>({});
  const refresh = useCallback(async () => {
    try {
      const data = await loadData();
      setState({ data: snapshot(data) });
    } catch (error: unknown) {
      setState({
        error: error instanceof Error ? error.message : "读取本地数据失败"
      });
    }
  }, []);

  useEffect(() => {
    void refresh();
    const handler = () => void refresh();
    window.addEventListener("worklog:data-changed", handler);
    window.addEventListener("worklog:data-refreshed", handler);
    return () => {
      window.removeEventListener("worklog:data-changed", handler);
      window.removeEventListener("worklog:data-refreshed", handler);
    };
  }, [refresh]);

  return { ...state, refresh };
}

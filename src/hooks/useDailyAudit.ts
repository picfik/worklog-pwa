import { useEffect, useState } from "react";
import type { AuditFinding } from "@/rules/audit";
import { getAllTasks, getDailyAudit } from "@/rules/audit";
import type { LocalData } from "@/types/storage";
import { getPendingUploads } from "@/store/pendingUploadsRepository";

interface DailyAuditState {
  findings?: AuditFinding[];
  error?: string;
}

export function useDailyAudit(data?: LocalData): DailyAuditState {
  const [state, setState] = useState<DailyAuditState>({});

  useEffect(() => {
    if (!data) return;
    let active = true;
    setState({});
    getPendingUploads()
      .then((pendingUploads) =>
        getDailyAudit(
          getAllTasks(data),
          data.attachments,
          pendingUploads
        )
      )
      .then((findings) => {
        if (active) setState({ findings });
      })
      .catch((error: unknown) => {
        if (active) {
          setState({
            error: error instanceof Error ? error.message : "巡检数据读取失败"
          });
        }
      });
    return () => {
      active = false;
    };
  }, [data]);

  return state;
}

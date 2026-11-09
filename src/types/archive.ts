import type { HistoryEvent } from "@/types/history";
import type { Task } from "@/types/task";

export interface ArchiveShard {
  month: `${number}${number}${number}${number}-${number}${number}`;
  tasks: Task[];
  historyEvents: HistoryEvent[];
}

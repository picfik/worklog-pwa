export type HistoryEventType =
  | "created"
  | "status_changed"
  | "attachment_added"
  | "role_changed"
  | "notes_updated"
  | "deadline_changed"
  | "synced";

export interface HistoryEvent {
  id: string;
  taskId: string;
  eventType: HistoryEventType;
  fromVal?: string;
  toVal?: string;
  at: string;
  deviceId: string;
}

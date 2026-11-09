export type TaskStatus = "todo" | "doing" | "done" | "archived";

export interface Task {
  id: string;
  title: string;
  status: TaskStatus;
  basisText: string;
  deadline: string | null;
  notes: string;
  createdAt: string;
  updatedAt: string;
  captureSessionId?: string;
  incomplete: boolean;
  basisNeedsConfirmation?: boolean;
}

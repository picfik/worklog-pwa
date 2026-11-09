import type { HistoryEvent, HistoryEventType } from "@/types/history";
import type { Task, TaskStatus } from "@/types/task";
import { getConfig } from "@/store/configRepository";
import { loadData, markDirty } from "@/store/dataRepository";
import { checkTransition } from "@/rules/gate";

export const DEFAULT_NOTES_TEMPLATE = "办理结果：\n\n依据摘要：\n\n后续事项：";

export interface CreateTaskInput {
  title: string;
  notes?: string;
  basisText?: string;
  deadline?: string | null;
  captureSessionId?: string;
}

export interface TaskFilter {
  status?: TaskStatus | TaskStatus[];
  includeArchived?: boolean;
}

export type TaskUpdate = Partial<
  Pick<Task, "title" | "notes" | "basisText" | "deadline" | "incomplete" | "basisNeedsConfirmation">
>;

export type HistoryEventInput = Omit<HistoryEvent, "id" | "at" | "deviceId"> &
  Partial<Pick<HistoryEvent, "at" | "deviceId">>;

function notifyDataChanged(): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event("worklog:data-changed"));
  }
}

async function getDeviceId(): Promise<string> {
  const config = await getConfig();
  if (!config?.deviceId) {
    throw new Error("尚未设置设备，请先完成设备初始化");
  }
  return config.deviceId;
}

function emitHistory(
  taskId: string,
  eventType: HistoryEventType,
  fromVal?: string,
  toVal?: string
): Promise<HistoryEvent> {
  return addHistory({
    taskId,
    eventType,
    ...(fromVal === undefined ? {} : { fromVal }),
    ...(toVal === undefined ? {} : { toVal })
  });
}

export async function addHistory(input: HistoryEventInput): Promise<HistoryEvent> {
  const data = await loadData();
  const deviceId = input.deviceId?.trim() || (await getDeviceId());
  const event: HistoryEvent = {
    ...input,
    id: crypto.randomUUID(),
    at: input.at ?? new Date().toISOString(),
    deviceId
  };
  data.statusHistory.push(event);
  await markDirty();
  notifyDataChanged();
  return event;
}

export async function createTask(input: CreateTaskInput): Promise<Task> {
  const title = input.title.trim();
  if (!title) {
    throw new Error("任务标题不能为空");
  }
  const data = await loadData();
  const now = new Date().toISOString();
  const task: Task = {
    id: crypto.randomUUID(),
    title,
    status: "todo",
    basisText: input.basisText ?? "",
    deadline: input.deadline ?? null,
    notes: input.notes?.trim() ? input.notes : DEFAULT_NOTES_TEMPLATE,
    createdAt: now,
    updatedAt: now,
    incomplete: false,
    ...(input.captureSessionId ? { captureSessionId: input.captureSessionId } : {})
  };
  data.tasks.push(task);
  await emitHistory(task.id, "created", undefined, task.title);
  await markDirty();
  notifyDataChanged();
  return task;
}

export async function getTask(taskId: string): Promise<Task | undefined> {
  const data = await loadData();
  const activeTask = data.tasks.find((task) => task.id === taskId);
  if (activeTask) {
    return activeTask;
  }
  for (const archive of Object.values(data.archives)) {
    const archivedTask = archive.tasks.find((task) => task.id === taskId);
    if (archivedTask) {
      return archivedTask;
    }
  }
  return undefined;
}

export async function listTasks(filter: TaskFilter = {}): Promise<Task[]> {
  const data = await loadData();
  const tasks = filter.includeArchived
    ? [...data.tasks, ...Object.values(data.archives).flatMap((shard) => shard.tasks)]
    : [...data.tasks];
  if (filter.status === undefined) {
    return tasks;
  }
  const statuses = Array.isArray(filter.status) ? filter.status : [filter.status];
  return tasks.filter((task) => statuses.includes(task.status));
}

export async function updateTask(taskId: string, updates: TaskUpdate): Promise<Task> {
  const data = await loadData();
  const task = data.tasks.find((item) => item.id === taskId);
  if (!task) {
    throw new Error("找不到可编辑的任务");
  }
  const previous = { ...task };
  if (updates.title !== undefined) {
    if (!updates.title.trim()) {
      throw new Error("任务标题不能为空");
    }
    task.title = updates.title.trim();
  }
  if (updates.notes !== undefined) {
    task.notes = updates.notes;
  }
  if (updates.basisText !== undefined) {
    task.basisText = updates.basisText;
    task.basisNeedsConfirmation = false;
  }
  if (updates.basisNeedsConfirmation !== undefined) {
    task.basisNeedsConfirmation = updates.basisNeedsConfirmation;
  }
  if (updates.deadline !== undefined) {
    task.deadline = updates.deadline;
  }
  if (updates.incomplete !== undefined) {
    task.incomplete = updates.incomplete;
  }
  if (task.status === "doing") {
    const hasBasisAttachment = data.attachments.some(
      (attachment) => attachment.taskId === taskId && attachment.role === "basis"
    );
    task.incomplete = !task.basisText.trim() && !hasBasisAttachment;
  }
  task.updatedAt = new Date().toISOString();

  if (previous.notes !== task.notes || previous.basisText !== task.basisText) {
    await emitHistory(
      taskId,
      "notes_updated",
      previous.notes || previous.basisText,
      task.notes || task.basisText
    );
  }
  if (previous.deadline !== task.deadline) {
    await emitHistory(taskId, "deadline_changed", previous.deadline ?? "", task.deadline ?? "");
  }
  await markDirty();
  notifyDataChanged();
  return task;
}

export async function archiveTask(taskId: string): Promise<Task> {
  const data = await loadData();
  const taskIndex = data.tasks.findIndex((task) => task.id === taskId);
  if (taskIndex < 0) {
    throw new Error("找不到可归档的任务");
  }
  const task = data.tasks[taskIndex];
  if (!task || task.status !== "done") {
    throw new Error("只有已完成的任务可以归档");
  }
  const transition = checkTransition(task, data.attachments, "archived");
  if (!transition.ok) {
    throw new Error(transition.gaps.map((gap) => gap.message).join(" "));
  }
  const event = await addHistory({
    taskId,
    eventType: "status_changed",
    fromVal: task.status,
    toVal: "archived"
  });
  const month = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}`;
  const shard = data.archives[month] ?? { month, tasks: [], historyEvents: [] };
  const archivedTask: Task = {
    ...task,
    status: "archived",
    updatedAt: event.at
  };
  shard.tasks.push(archivedTask);
  const taskEvents = data.statusHistory.filter((item) => item.taskId === taskId);
  shard.historyEvents.push(...taskEvents);
  data.archives[month] = shard;
  data.statusHistory = data.statusHistory.filter((item) => item.taskId !== taskId);
  data.tasks.splice(taskIndex, 1);
  await markDirty();
  notifyDataChanged();
  return archivedTask;
}

export async function changeStatus(taskId: string, nextStatus: TaskStatus): Promise<Task> {
  if (nextStatus === "archived") {
    return archiveTask(taskId);
  }
  const data = await loadData();
  const task = data.tasks.find((item) => item.id === taskId);
  if (!task) {
    throw new Error("找不到任务");
  }
  const allowed: Record<TaskStatus, TaskStatus[]> = {
    todo: ["doing"],
    doing: ["todo", "done"],
    done: [],
    archived: []
  };
  if (!allowed[task.status].includes(nextStatus)) {
    throw new Error(`不支持从“${task.status}”变更为“${nextStatus}”`);
  }
  const transition = checkTransition(task, data.attachments, nextStatus);
  if (!transition.ok) {
    throw new Error(transition.gaps.map((gap) => gap.message).join(" "));
  }
  const previousStatus = task.status;
  task.status = nextStatus;
  task.updatedAt = new Date().toISOString();
  if (previousStatus === "todo" && nextStatus === "doing") {
    const hasBasisAttachment = data.attachments.some(
      (attachment) => attachment.taskId === taskId && attachment.role === "basis"
    );
    task.incomplete = !task.basisText.trim() && !hasBasisAttachment;
  }
  await emitHistory(taskId, "status_changed", previousStatus, nextStatus);
  await markDirty();
  notifyDataChanged();
  return task;
}

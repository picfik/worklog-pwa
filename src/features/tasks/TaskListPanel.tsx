import { useState } from "react";
import type { Task, TaskStatus } from "@/types/task";
import { taskStatusLabels } from "@/features/tasks/taskLabels";

const groups: TaskStatus[] = ["todo", "doing", "done"];

interface TaskListPanelProps {
  tasks: Task[];
  selectedId?: string;
  onSelect: (task: Task) => void;
  onCreate: () => void;
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
  criticalTaskIds?: Set<string>;
}

export function TaskListPanel({
  tasks,
  selectedId,
  onSelect,
  onCreate,
  collapsed = false,
  onToggleCollapsed,
  criticalTaskIds = new Set()
}: TaskListPanelProps) {
  const [collapsedGroups, setCollapsedGroups] = useState<Set<TaskStatus>>(new Set());
  const criticalTasks = tasks.filter((task) => criticalTaskIds.has(task.id));
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm sm:p-4">
      <div className="flex items-center justify-between gap-2 px-1 pb-3">
        <h2 className="font-semibold text-slate-900">任务列表</h2>
        <div className="flex items-center gap-2">
          {onToggleCollapsed && (
            <button
              type="button"
              onClick={onToggleCollapsed}
              className="rounded-md px-2 py-1 text-xs text-slate-500 hover:bg-slate-100"
              aria-label={collapsed ? "展开任务列表" : "折叠任务列表"}
            >
              {collapsed ? "展开" : "折叠"}
            </button>
          )}
          <button
            type="button"
            onClick={onCreate}
            className="rounded-lg bg-navy px-3 py-2 text-xs font-medium text-white"
          >
            新建任务
          </button>
        </div>
      </div>
      {!collapsed && criticalTasks.length > 0 && (
        <section className="mb-2 rounded-xl border border-red-200 bg-red-50 p-2">
          <h3 className="px-1 py-2 text-xs font-semibold text-red-800">
            🔴 优先处理（{criticalTasks.length}）
          </h3>
          <ul className="space-y-1">
            {criticalTasks.map((task) => (
              <li key={task.id}>
                <button
                  type="button"
                  onClick={() => onSelect(task)}
                  className={`flex w-full items-start gap-2 rounded-lg px-2.5 py-2 text-left text-sm ${
                    task.id === selectedId ? "bg-white text-red-900" : "text-red-800 hover:bg-white/70"
                  }`}
                >
                  <span className="min-w-0 flex-1 truncate">{task.title}</span>
                  <span className="shrink-0 text-[11px]">{taskStatusLabels[task.status]}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
      {!collapsed && groups.map((status) => {
        const totalGroupCount = tasks.filter((task) => task.status === status).length;
        const groupTasks = tasks.filter(
          (task) => task.status === status && !criticalTaskIds.has(task.id)
        );
        const isCollapsed = collapsedGroups.has(status);
        return (
          <section key={status} className="border-t border-slate-100 py-2">
            <button
              type="button"
              onClick={() =>
                setCollapsedGroups((previous) => {
                  const next = new Set(previous);
                  if (next.has(status)) next.delete(status);
                  else next.add(status);
                  return next;
                })
              }
              className="flex w-full items-center justify-between px-1 py-2 text-left text-xs font-semibold text-slate-500"
              aria-expanded={!isCollapsed}
            >
              <span>{taskStatusLabels[status]}（{totalGroupCount}）</span>
              <span aria-hidden="true">{isCollapsed ? "＋" : "−"}</span>
            </button>
            {!isCollapsed && (
              <ul className="space-y-1">
                {groupTasks.map((task) => (
                  <li key={task.id}>
                    <button
                      type="button"
                      onClick={() => onSelect(task)}
                      className={`flex w-full items-start gap-2 rounded-lg px-2.5 py-2 text-left text-sm ${
                        task.id === selectedId ? "bg-blue-50 text-navy" : "hover:bg-slate-50"
                      }`}
                    >
                      {task.incomplete && (
                        <span
                          className="mt-1 inline-block h-2 w-2 shrink-0 rounded-full bg-red-600"
                          aria-label="留痕不完整"
                        />
                      )}
                      <span className="min-w-0 flex-1 truncate">{task.title}</span>
                      {task.deadline && (
                        <time className="shrink-0 text-[11px] text-slate-400">
                          {task.deadline.slice(5, 10)}
                        </time>
                      )}
                    </button>
                  </li>
                ))}
                {groupTasks.length === 0 && (
                  <li className="px-2.5 py-2 text-xs text-slate-400">
                    {totalGroupCount > 0 ? "问题任务已列在优先处理区" : "暂无任务"}
                  </li>
                )}
              </ul>
            )}
          </section>
        );
      })}
    </section>
  );
}

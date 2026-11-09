import Fuse from "fuse.js";
import { useMemo } from "react";
import { Link, useSearchParams } from "react-router-dom";
import type { Attachment } from "@/types/attachment";
import type { Task, TaskStatus } from "@/types/task";
import { useAppData } from "@/hooks/useAppData";
import { formatDate } from "@/utils/date";
import { formatFileSize } from "@/features/attachments/attachmentPresentation";

type SearchItem =
  | { kind: "task"; id: string; task: Task; title: string; notes: string; basisText: string; date: string }
  | { kind: "attachment"; id: string; attachment: Attachment; name: string; note: string; ext: string; date: string };

const statuses: Array<TaskStatus | "all"> = ["all", "todo", "doing", "done", "archived"];
const statusNames: Record<TaskStatus | "all", string> = {
  all: "全部状态",
  todo: "待办",
  doing: "进行中",
  done: "已完成",
  archived: "已归档"
};
const ranges = ["all", "week", "month", "custom"] as const;
type DateRange = typeof ranges[number];

function isTaskStatus(value: string): value is TaskStatus {
  return value === "todo" || value === "doing" || value === "done" || value === "archived";
}

function formatPercentDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "时间未知" : formatDate(date);
}

function Highlight({ text, query }: { text: string; query: string }) {
  const terms = query.trim().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return <>{text}</>;
  const pattern = new RegExp(`(${terms.map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "ig");
  return (
    <>
      {text.split(pattern).map((part, index) =>
        terms.some((term) => part.toLocaleLowerCase() === term.toLocaleLowerCase())
          ? <mark key={`${part}-${index}`} className="rounded bg-yellow-200 px-0.5">{part}</mark>
          : part
      )}
    </>
  );
}

function withinRange(value: string, range: DateRange, from: string, to: string): boolean {
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return false;
  const date = new Date(time);
  if (range === "week") {
    const now = new Date();
    const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
    monday.setHours(0, 0, 0, 0);
    return time >= monday.getTime();
  }
  if (range === "month") {
    const now = new Date();
    return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth();
  }
  if (range === "custom") {
    if (from && time < new Date(`${from}T00:00:00`).getTime()) return false;
    if (to && time > new Date(`${to}T23:59:59.999`).getTime()) return false;
  }
  return true;
}

export function SearchPage() {
  const { data, error } = useAppData();
  const [params, setParams] = useSearchParams();
  const query = params.get("q") ?? "";
  const statusValue = params.get("status") ?? "all";
  const status = isTaskStatus(statusValue) ? statusValue : "all";
  const rangeValue = params.get("range") ?? "all";
  const range: DateRange = ranges.includes(rangeValue as DateRange)
    ? rangeValue as DateRange
    : "all";
  const evidence = params.get("evidence") ?? "all";
  const docNo = params.get("doc") ?? "";
  const deviceId = params.get("device") ?? "all";
  const from = params.get("from") ?? "";
  const to = params.get("to") ?? "";

  const tasks = useMemo(() => data ? [
    ...data.tasks,
    ...Object.values(data.archives).flatMap((shard) => shard.tasks)
  ] : [], [data]);
  const items = useMemo<SearchItem[]>(() => [
    ...tasks.map((task) => ({
      kind: "task" as const,
      id: task.id,
      task,
      title: task.title,
      notes: task.notes,
      basisText: task.basisText,
      date: task.updatedAt
    })),
    ...(data?.attachments ?? []).map((attachment) => ({
      kind: "attachment" as const,
      id: attachment.id,
      attachment,
      name: attachment.name,
      note: attachment.note ?? "",
      ext: attachment.ext,
      date: attachment.uploadedAt || ""
    }))
  ], [data?.attachments, tasks]);
  const fuse = useMemo(
    () => new Fuse<SearchItem>(items, {
      keys: [
        { name: "title", weight: 2 },
        { name: "notes", weight: 1 },
        { name: "basisText", weight: 1.8 },
        { name: "name", weight: 2 },
        { name: "note", weight: 1 },
        { name: "ext", weight: 0.6 }
      ],
      includeMatches: true,
      threshold: 0.38,
      ignoreLocation: true
    }),
    [items]
  );

  const results = useMemo(() => {
    if (!data) return [];
    const historyTaskIds = new Set(
      [...data.statusHistory, ...Object.values(data.archives).flatMap((shard) => shard.historyEvents)]
        .filter((event) => deviceId === "all" || event.deviceId === deviceId)
        .map((event) => event.taskId)
    );
    const taskById = new Map(tasks.map((task) => [task.id, task]));
    const queryResults = query.trim() ? fuse.search(query).map((result) => result.item) : items;
    return queryResults.filter((item) => {
      const task = item.kind === "task" ? item.task : taskById.get(item.attachment.taskId);
      if (!task) return false;
      if (status !== "all" && task.status !== status) return false;
      if (deviceId !== "all" && !historyTaskIds.has(task.id)) return false;
      const dateValue = item.kind === "task" ? item.date : item.attachment.uploadedAt || task.updatedAt;
      if (range !== "all" && !withinRange(dateValue, range, from, to)) return false;
      if (evidence !== "all") {
        const hasEvidence = (data.attachments ?? []).some(
          (attachment) => attachment.taskId === task.id && attachment.role === "evidence"
        );
        if (evidence === "yes" && !hasEvidence) return false;
        if (evidence === "no" && hasEvidence) return false;
      }
      if (docNo.trim()) {
        const searchable = item.kind === "task"
          ? `${task.basisText} ${task.title}`
          : `${item.attachment.name} ${item.attachment.note ?? ""}`;
        if (!searchable.toLocaleLowerCase().includes(docNo.trim().toLocaleLowerCase())) return false;
      }
      return true;
    });
  }, [data, deviceId, docNo, evidence, from, fuse, items, query, range, status, tasks, to]);

  function updateParam(key: string, value: string) {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  }

  if (error) return <p className="rounded-xl bg-red-50 p-4 text-sm text-red-700">{error}</p>;
  if (!data) return <p className="text-sm text-slate-500">正在读取搜索索引…</p>;

  const taskResults = results.filter((item): item is Extract<SearchItem, { kind: "task" }> => item.kind === "task");
  const attachmentResults = results.filter(
    (item): item is Extract<SearchItem, { kind: "attachment" }> => item.kind === "attachment"
  );
  const deviceNames = new Map(data.devices.map((device) => [device.id, device.name]));
  const deviceIds = Array.from(new Set(data.statusHistory.map((event) => event.deviceId)));
  for (const shard of Object.values(data.archives)) {
    for (const event of shard.historyEvents) deviceIds.push(event.deviceId);
  }

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-xl font-semibold text-slate-900">全局搜索</h1>
        <p className="mt-1 text-sm text-slate-500">搜索任务标题、依据、备注，以及附件名、备注和格式。</p>
      </header>
      <input
        autoFocus
        type="search"
        value={query}
        onChange={(event) => updateParam("q", event.target.value)}
        placeholder="关键词、文号或附件名"
        className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm shadow-sm outline-none focus:border-blue-600"
      />
      <div className="grid gap-2 rounded-xl border border-slate-200 bg-white p-3 sm:grid-cols-2 lg:grid-cols-4">
        <label className="grid gap-1 text-xs text-slate-500">
          状态
          <select value={status} onChange={(event) => updateParam("status", event.target.value)} className="rounded-md border border-slate-300 bg-white px-2 py-2 text-sm text-slate-800">
            {statuses.map((item) => <option key={item} value={item}>{statusNames[item]}</option>)}
          </select>
        </label>
        <label className="grid gap-1 text-xs text-slate-500">
          时间范围
          <select value={range} onChange={(event) => updateParam("range", event.target.value)} className="rounded-md border border-slate-300 bg-white px-2 py-2 text-sm text-slate-800">
            <option value="all">不限</option><option value="week">本周</option><option value="month">本月</option><option value="custom">自定义</option>
          </select>
        </label>
        <label className="grid gap-1 text-xs text-slate-500">
          佐证
          <select value={evidence} onChange={(event) => updateParam("evidence", event.target.value)} className="rounded-md border border-slate-300 bg-white px-2 py-2 text-sm text-slate-800">
            <option value="all">不限</option><option value="yes">有佐证</option><option value="no">无佐证</option>
          </select>
        </label>
        <label className="grid gap-1 text-xs text-slate-500">
          设备
          <select value={deviceId} onChange={(event) => updateParam("device", event.target.value)} className="rounded-md border border-slate-300 bg-white px-2 py-2 text-sm text-slate-800">
            <option value="all">全部设备</option>
            {Array.from(new Set(deviceIds)).map((id) => <option key={id} value={id}>{deviceNames.get(id) ?? id}</option>)}
          </select>
        </label>
        {range === "custom" && (
          <>
            <label className="grid gap-1 text-xs text-slate-500">开始日期
              <input type="date" value={from} onChange={(event) => updateParam("from", event.target.value)} className="rounded-md border border-slate-300 px-2 py-2 text-sm text-slate-800" />
            </label>
            <label className="grid gap-1 text-xs text-slate-500">结束日期
              <input type="date" value={to} onChange={(event) => updateParam("to", event.target.value)} className="rounded-md border border-slate-300 px-2 py-2 text-sm text-slate-800" />
            </label>
          </>
        )}
        <label className="grid gap-1 text-xs text-slate-500 sm:col-span-2">
          文号过滤
          <input value={docNo} onChange={(event) => updateParam("doc", event.target.value)} placeholder="例如：〔2026〕3号" className="rounded-md border border-slate-300 px-2 py-2 text-sm text-slate-800" />
        </label>
      </div>
      <p className="text-xs text-slate-500">共 {results.length} 条结果 · 当前过滤条件保存在 URL 中，可收藏。</p>

      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="font-semibold text-slate-900">任务（{taskResults.length}）</h2>
        {taskResults.length === 0 ? <p className="mt-3 text-sm text-slate-400">没有匹配任务</p> : (
          <ul className="mt-2 divide-y divide-slate-100">
            {taskResults.map(({ task }) => (
              <li key={task.id} className="py-3">
                <Link to={`/task/${task.id}`} className="font-medium text-blue-800 hover:underline">
                  <Highlight text={task.title} query={query || docNo} />
                </Link>
                <p className="mt-1 text-xs text-slate-400">{statusNames[task.status]} · 更新于 {formatPercentDate(task.updatedAt)}</p>
                {task.basisText && <p className="mt-1 line-clamp-2 text-sm text-slate-600"><Highlight text={task.basisText} query={query || docNo} /></p>}
                {task.notes && <p className="mt-1 line-clamp-2 text-xs text-slate-500"><Highlight text={task.notes} query={query} /></p>}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="font-semibold text-slate-900">附件（{attachmentResults.length}）</h2>
        {attachmentResults.length === 0 ? <p className="mt-3 text-sm text-slate-400">没有匹配附件</p> : (
          <ul className="mt-2 divide-y divide-slate-100">
            {attachmentResults.map(({ attachment }) => {
              const task = tasks.find((item) => item.id === attachment.taskId);
              return (
                <li key={attachment.id} className="py-3">
                  <p className="break-all text-sm font-medium text-slate-800"><Highlight text={attachment.name} query={query || docNo} /></p>
                  <p className="mt-1 text-xs text-slate-500">
                    {attachment.role} · {attachment.ext.toUpperCase() || "无格式"} · {formatFileSize(attachment.size)}
                    {task ? <> · 所属任务 <Link to={`/task/${task.id}`} className="text-blue-700 underline">{task.title}</Link></> : ""}
                  </p>
                  {attachment.note && <p className="mt-1 text-xs text-slate-500"><Highlight text={attachment.note} query={query} /></p>}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}

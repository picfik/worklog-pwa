import { useMemo } from "react";
import { Link, useSearchParams } from "react-router-dom";
import type { HistoryEventType } from "@/types/history";
import { useAppData } from "@/hooks/useAppData";
import { getAllHistory } from "@/reports/periods";
import { describeHistoryEvent, formatEventTime } from "@/features/tasks/taskLabels";

const eventTypes: Array<HistoryEventType | "all"> = [
  "all",
  "created",
  "status_changed",
  "attachment_added",
  "role_changed",
  "notes_updated",
  "deadline_changed",
  "synced"
];
const eventLabels: Record<HistoryEventType | "all", string> = {
  all: "全部事件",
  created: "新建任务",
  status_changed: "状态变更",
  attachment_added: "添加附件",
  role_changed: "附件归类",
  notes_updated: "更新备注/依据",
  deadline_changed: "调整截止日期",
  synced: "同步"
};
const ranges = ["all", "week", "month", "custom"] as const;
type Range = typeof ranges[number];

function isEventType(value: string): value is HistoryEventType {
  return eventTypes.includes(value as HistoryEventType);
}

function isInRange(value: string, range: Range, from: string, to: string): boolean {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return false;
  const date = new Date(timestamp);
  if (range === "week") {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
    start.setHours(0, 0, 0, 0);
    return timestamp >= start.getTime();
  }
  if (range === "month") {
    const now = new Date();
    return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth();
  }
  if (range === "custom") {
    if (from && timestamp < new Date(`${from}T00:00:00`).getTime()) return false;
    if (to && timestamp > new Date(`${to}T23:59:59.999`).getTime()) return false;
  }
  return true;
}

export function TimelinePage() {
  const { data, error } = useAppData();
  const [params, setParams] = useSearchParams();
  const rangeValue = params.get("range") ?? "all";
  const range: Range = ranges.includes(rangeValue as Range) ? rangeValue as Range : "all";
  const typeValue = params.get("type") ?? "all";
  const type = isEventType(typeValue) ? typeValue : "all";
  const from = params.get("from") ?? "";
  const to = params.get("to") ?? "";

  const events = useMemo(() => {
    if (!data) return [];
    return getAllHistory(data).filter((event) =>
      (type === "all" || event.eventType === type) &&
      isInRange(event.at, range, from, to)
    );
  }, [data, from, range, to, type]);

  function updateParam(key: string, value: string) {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  }

  if (error) return <p className="rounded-xl bg-red-50 p-4 text-sm text-red-700">{error}</p>;
  if (!data) return <p className="text-sm text-slate-500">正在读取时间线…</p>;

  const tasks = new Map([
    ...data.tasks.map((task) => [task.id, task.title] as const),
    ...Object.values(data.archives).flatMap((shard) =>
      shard.tasks.map((task) => [task.id, task.title] as const)
    )
  ]);
  const devices = new Map(data.devices.map((device) => [device.id, device.name]));
  const deviceIds = Array.from(new Set(events.map((event) => event.deviceId)));

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-xl font-semibold text-slate-900">留痕时间线</h1>
        <p className="mt-1 text-sm text-slate-500">所有任务事件按发生时间倒序合并展示。</p>
      </header>
      <div className="grid gap-2 rounded-xl border border-slate-200 bg-white p-3 sm:grid-cols-2 lg:grid-cols-4">
        <label className="grid gap-1 text-xs text-slate-500">时间范围
          <select value={range} onChange={(event) => updateParam("range", event.target.value)} className="rounded-md border border-slate-300 bg-white px-2 py-2 text-sm text-slate-800">
            <option value="all">不限</option><option value="week">本周</option><option value="month">本月</option><option value="custom">自定义</option>
          </select>
        </label>
        <label className="grid gap-1 text-xs text-slate-500">事件类型
          <select value={type} onChange={(event) => updateParam("type", event.target.value)} className="rounded-md border border-slate-300 bg-white px-2 py-2 text-sm text-slate-800">
            {eventTypes.map((item) => <option key={item} value={item}>{eventLabels[item]}</option>)}
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
      </div>
      <p className="text-xs text-slate-500">共 {events.length} 条事件</p>
      {events.length === 0 ? (
        <section className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-400">
          当前条件下暂无留痕事件
        </section>
      ) : (
        <ol className="space-y-3">
          {events.map((event) => (
            <li key={`${event.id}-${event.at}`} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <time className="text-xs font-medium text-slate-500">{formatEventTime(event.at)}</time>
                <span className="text-xs text-slate-400">
                  {devices.get(event.deviceId) ?? `未知设备（${event.deviceId.slice(0, 8)}）`}
                </span>
              </div>
              <p className="mt-2 text-sm text-slate-800">
                {describeHistoryEvent(event.eventType, event.fromVal, event.toVal)}
              </p>
              <p className="mt-2 text-xs text-slate-500">
                关联任务：
                {tasks.has(event.taskId)
                  ? <Link to={`/task/${event.taskId}`} className="ml-1 text-blue-700 underline">{tasks.get(event.taskId)}</Link>
                  : <span className="ml-1">任务记录不可用</span>}
              </p>
            </li>
          ))}
        </ol>
      )}
      {deviceIds.length > 0 && (
        <p className="text-xs text-slate-400">
          当前结果包含 {new Set(deviceIds).size} 台设备的留痕。
        </p>
      )}
    </div>
  );
}

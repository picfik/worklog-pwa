import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import type { Device } from "@/types/device";
import type { AppConfig, LocalData } from "@/types/storage";
import { loadData, saveData } from "@/store/dataRepository";
import { setConfig } from "@/store/configRepository";

interface SetupPageProps {
  onConfigured: (config: AppConfig) => void;
}

export function SetupPage({ onConfigured }: SetupPageProps) {
  const navigate = useNavigate();
  const [deviceName, setDeviceName] = useState("");
  const [bucket, setBucket] = useState(() => import.meta.env.VITE_OSS_BUCKET ?? "");
  const [region, setRegion] = useState(() => import.meta.env.VITE_OSS_REGION ?? "");
  const [endpoint, setEndpoint] = useState(() => import.meta.env.VITE_OSS_ENDPOINT ?? "");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    if (!deviceName.trim()) {
      setError("设备名称不能为空");
      return;
    }
    if (!bucket.trim() || !region.trim() || !endpoint.trim()) {
      setError("OSS bucket、region 和 endpoint 均为必填项");
      return;
    }
    setSaving(true);
    try {
      const deviceId = crypto.randomUUID();
      const now = new Date().toISOString();
      const config: AppConfig = {
        deviceId,
        deviceName: deviceName.trim(),
        oss: {
          bucket: bucket.trim(),
          region: region.trim(),
          endpoint: endpoint.trim(),
          accessKeyId: "",
          accessKeySecret: ""
        }
      };
      const device: Device = { id: deviceId, name: config.deviceName, lastSeenAt: now };
      const localData: LocalData = await loadData();
      localData.devices = [...localData.devices.filter((item) => item.id !== deviceId), device];
      await saveData(localData);
      await setConfig(config);
      onConfigured(config);
      navigate("/", { replace: true });
    } catch (submitError: unknown) {
      setError(
        submitError instanceof Error ? submitError.message : "保存配置失败，请重试"
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl items-center px-4 py-8">
      <form
        onSubmit={handleSubmit}
        className="w-full rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-8"
      >
        <p className="text-sm font-medium text-navy">首次设置</p>
        <h1 className="mt-1 text-2xl font-semibold text-slate-900">配置工作留痕</h1>
        <p className="mt-2 text-sm leading-6 text-slate-500">
          OSS AccessKey 由 GitHub Actions 构建时自动注入，本页只需填写设备名称和 OSS 存储位置信息。
        </p>
        <div className="mt-6 grid gap-4">
          <label className="grid gap-1.5 text-sm font-medium text-slate-700">
            设备名称
            <input
              required
              maxLength={60}
              value={deviceName}
              onChange={(event) => setDeviceName(event.target.value)}
              placeholder="例如：工作手机"
              className="rounded-lg border border-slate-300 px-3 py-2.5 font-normal outline-none focus:border-blue-600"
            />
          </label>
          <label className="grid gap-1.5 text-sm font-medium text-slate-700">
            OSS Bucket
            <input
              required
              value={bucket}
              onChange={(event) => setBucket(event.target.value)}
              className="rounded-lg border border-slate-300 px-3 py-2.5 font-normal outline-none focus:border-blue-600"
            />
          </label>
          <label className="grid gap-1.5 text-sm font-medium text-slate-700">
            OSS Region
            <input
              required
              value={region}
              onChange={(event) => setRegion(event.target.value)}
              placeholder="例如：oss-cn-hangzhou"
              className="rounded-lg border border-slate-300 px-3 py-2.5 font-normal outline-none focus:border-blue-600"
            />
          </label>
          <label className="grid gap-1.5 text-sm font-medium text-slate-700">
            OSS Endpoint
            <input
              required
              type="url"
              value={endpoint}
              onChange={(event) => setEndpoint(event.target.value)}
              placeholder="https://oss-cn-hangzhou.aliyuncs.com"
              className="rounded-lg border border-slate-300 px-3 py-2.5 font-normal outline-none focus:border-blue-600"
            />
          </label>
          <label className="grid gap-1.5 text-sm font-medium text-slate-700">
            OSS AccessKey
            <input
              disabled
              value="由 GitHub Actions 构建时注入（无需填写）"
              className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 font-mono text-xs font-normal text-slate-400"
            />
          </label>
        </div>
        {error && (
          <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
            {error}
          </p>
        )}
        <button
          type="submit"
          disabled={saving}
          className="mt-6 w-full rounded-lg bg-navy px-4 py-3 text-sm font-semibold text-white hover:bg-blue-900 disabled:opacity-60"
        >
          {saving ? "正在保存…" : "保存并进入工作台"}
        </button>
      </form>
    </main>
  );
}

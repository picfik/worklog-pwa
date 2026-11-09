import { Link } from "react-router-dom";

export function AboutPage() {
  return (
    <section className="mx-auto max-w-2xl space-y-5 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-8">
      <header>
        <h1 className="text-xl font-semibold text-slate-900">关于工作留痕</h1>
        <p className="mt-2 text-sm leading-6 text-slate-600">
          工作留痕是单用户个人工作记录 PWA。任务和附件元数据保存在本机 IndexedDB，并通过 OSS 即时签名与云端分片同步。
        </p>
      </header>
      <section>
        <h2 className="text-sm font-semibold text-slate-800">数据与安全</h2>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm leading-6 text-slate-600">
          <li>OSS AccessKey 由 GitHub Actions 构建时注入；请使用仅授予目标 Bucket 读写权限的最小权限 RAM 子账号。</li>
          <li>OSS 对象存储数据；GitHub Pages 仅托管应用静态文件。</li>
          <li>单终端串行写入，不支持多个终端同时修改后的自动合并。</li>
        </ul>
      </section>
      <section>
        <h2 className="text-sm font-semibold text-slate-800">常用入口</h2>
        <div className="mt-2 flex flex-wrap gap-3 text-sm text-blue-700">
          <Link to="/settings" className="underline">设置</Link>
          <Link to="/audit" className="underline">巡检看板</Link>
          <Link to="/search" className="underline">全局搜索</Link>
        </div>
      </section>
    </section>
  );
}

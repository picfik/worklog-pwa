import { Link } from "react-router-dom";

export function AboutPage() {
  return (
    <section className="mx-auto max-w-2xl space-y-5 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-8">
      <header>
        <h1 className="text-xl font-semibold text-slate-900">关于工作留痕</h1>
        <p className="mt-2 text-sm leading-6 text-slate-600">
          工作留痕是单用户个人工作记录 PWA。任务和附件元数据保存在本机 IndexedDB，并通过用户提供的 OSS 预签名 URL 与云端分片同步。
        </p>
      </header>
      <section>
        <h2 className="text-sm font-semibold text-slate-800">数据与安全</h2>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm leading-6 text-slate-600">
          <li>AccessKey 不存入 PWA。预签名 URL 仅存在当前浏览器的 IndexedDB，并有过期时间。</li>
          <li>OSS 对象存储数据；GitHub Pages 仅托管应用静态文件。</li>
          <li>建议预签名 URL 使用最小权限、短有效期，并在不用时清理 URL 池。</li>
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

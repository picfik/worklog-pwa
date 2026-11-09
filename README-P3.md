# P3 同步验收清单

## 本地预签名脚本

- [x] 新增 `scripts/sign-presign.mjs`，用 `ali-oss` 从环境变量创建 24 小时有效的 PUT/GET 预签名 URL；每种操作输出 50 条并写到 stdout。
- [x] 脚本覆盖 manifest、基础 JSON 分片、未来 12 个月归档分片和附件对象 key；提示将 JSON 复制到 PWA 设置页。
- [ ] 用仅授予目标 bucket `PutObject`、`GetObject` 权限的 AccessKey 执行脚本，粘贴 JSON 并验证池内容。
- [x] 用临时测试值验证脚本输出 50 条 PUT、50 条 GET，含重复 manifest URL 和签名 Content-Type；未输出实际 AccessKey。
- [ ] 在本地终端设置真实环境变量后运行脚本，并将 stdout JSON 粘贴到设置页。
- [ ] AccessKey 仅保存在本机环境变量，不写入仓库、PWA 代码或 GitHub Pages。

PowerShell 示例（替换为自己的 bucket、region、endpoint 和密钥；不要提交或分享终端输出）：

```powershell
$env:OSS_ACCESS_KEY_ID = "本机AccessKeyId"
$env:OSS_ACCESS_KEY_SECRET = "本机AccessKeySecret"
$env:OSS_BUCKET = "你的bucket"
$env:OSS_REGION = "oss-cn-hangzhou"
$env:OSS_ENDPOINT = "https://oss-cn-hangzhou.aliyuncs.com"
node .\scripts\sign-presign.mjs | Set-Clipboard
```

建议给 AccessKey 限定在目标 bucket，并只授予对象级 `PutObject`、`GetObject` 权限；脚本不需要 `ListBucket` 或删除权限。生成的 URL 仅有效 24 小时。

## 分片同步

- [x] 分片按 `worklog/tasks.json`、`attachments.json`、`status_history.json`、`devices.json`、`archive/YYYY-MM.json` 序列化并计算 SHA-256。
- [x] PUSH 先上传所有待上传附件，再上传内容变化的数据分片，最后 PUT manifest；同步失败保留本地 dirty。
- [x] PULL 按 manifest SHA-256 仅下载变化分片，校验哈希后整体替换对应本地数据。
- [x] 冲突使用二选一，不执行多端自动合并；归档月分片参与 manifest 和同步。
- [x] 启动 pristine/无本地数据时，在显示工作台前尝试全量拉取；线上拉取失败时提供重试与设置入口。
- [x] 本地 CORS OSS 模拟器验证基础分片上传、manifest version 1 与远端版本 2 分片拉取及 SHA-256 校验。
- [x] 在同一浏览器模拟远端版本领先，验证冲突弹窗的“放弃本地用远端”和“用本地覆盖远端”分支。
- [x] 归档本地任务后同步，确认 `archive/2026-11.json` 存在、`tasks` count 为 0 且 manifest 到 version 8。
- [x] 删除本地 `data/current` 后刷新，验证工作台渲染前显示“本地数据已丢失，将从云端恢复”，拉取完成后提示恢复成功。
- [ ] 终端 A 新建 3 个任务并同步，确认真实 OSS manifest 和各基础分片存在且版本为 1。
- [ ] 终端 B 使用独立浏览器 profile 首次配置后，确认工作台显示前完成全量拉取并得到 3 个任务；修改任务同步为 version 2。
- [ ] 终端 A 刷新后从真实 OSS 拉取 version 2。
- [ ] 在真实 OSS 与两个终端上重复验证冲突处理和归档同步。

## 设置与自动触发

- [x] 设置页显示本地/远端版本、dirty 状态、最近同步时间、立即同步按钮和最近 20 条同步日志。
- [x] 网络恢复、回到前台、桌面保存（800ms）和手机保存（3s）触发自动同步。
- [x] 顶部状态可显示已同步版本、待同步项目、同步失败重试入口。
- [x] 本地浏览器验证自动保存推送、冲突弹窗和 URL 池用尽错误提示。
- [ ] 在 Firefox、iOS Safari 验证自动同步触发、切后台/回前台和冲突弹窗。

## 验证环境说明

- [ ] 以上尚未勾选的跨 profile/iOS 验收需要真实 OSS bucket；不得在提交或公开日志中粘贴 AccessKey 或预签名 URL。
- [x] 执行 `npm run build`，TypeScript strict 检查和 PWA production build 通过。

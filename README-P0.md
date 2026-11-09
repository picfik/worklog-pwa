# P0 验收清单

## 构建

- [x] 执行 `npm ci` 安装锁定依赖。
- [x] 执行 `npm run build`，构建成功且无 TypeScript 错误。
- [x] 检查 `dist/manifest.webmanifest`：名称为“工作留痕”、`display` 为 `standalone`，并包含 192/512 PNG 图标。

## 初始化与本地存储

- [x] 首次打开应用进入 `/setup`。
- [x] 填写设备名、OSS bucket/region/endpoint 和合法预签名 URL JSON 后保存，进入 `/`。
- [x] 刷新页面后仍进入工作台；设置页显示设备信息、OSS 配置及有效 URL 数量和最近到期时间。
- [x] DevTools → Application → IndexedDB → `worklog-pwa` 中能看到 `data`、`config`、`presignPool`、`pendingUploads`、`syncLog` 五个对象仓库，以及 `data/current` 和 `config/app` 记录。
- [ ] 在应用模块中调用 `loadData()`，首次返回约定的空结构；调用 `saveData()` 保存变更后刷新，数据仍存在。
- [ ] 调用 `markDirty()` 后约 800ms，`data/current.dirty` 被持久化为 `true`。

## PWA 与部署

- [ ] 在 GitHub 仓库设置 Pages 使用 GitHub Actions；推送到 `main` 后工作流执行 `npm ci`、build 和部署。
- [x] GitHub Actions 构建使用仓库名作为 Vite base path。
- [ ] 使用 iOS Safari 打开部署地址，可添加到主屏幕并以独立窗口启动。

## 配置清除

- [ ] 设置页“清空本地数据并重新拉取”显示 P3 尚未接入提示，不执行清除或网络请求。
- [x] 确认“锁定清除配置”后清除配置、本地数据和预签名 URL 池，并返回 `/setup`。

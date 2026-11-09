# 工作留痕 PWA

个人工作留痕工具，采用 React、TypeScript、Vite、Tailwind CSS 和 IndexedDB；以静态站点部署到 GitHub Pages，业务数据仅保存在用户浏览器及后续配置的 OSS 中。

## 本地开发

```sh
npm ci
npm run dev
npm run build
npm run preview
```

GitHub Actions 会从 `GITHUB_REPOSITORY` 读取仓库名设置 Pages base path，并将构建产物部署到 GitHub Pages。`404.html` 是 BrowserRouter 的静态托管回退页。

P0 只提供工程骨架、本地存储、设备初始化和设置页；PUSH/PULL、任务管理和附件处理将在后续阶段接入。OSS 长期密钥不得放入前端或仓库。

详细验收步骤见 [README-P0.md](./README-P0.md)。

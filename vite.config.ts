import { copyFile } from "node:fs/promises";
import { fileURLToPath, URL } from "node:url";
import { resolve } from "node:path";
import type { Plugin } from "vite";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

const repositoryName = process.env.GITHUB_REPOSITORY?.split("/").at(-1);
const base =
  process.env.GITHUB_ACTIONS === "true" && repositoryName
    ? `/${repositoryName}/`
    : "/";

const pagesRouteFallback: Plugin = {
  name: "github-pages-route-fallback",
  async writeBundle(options) {
    const outputDirectory = resolve(options.dir ?? "dist");
    await copyFile(
      resolve(outputDirectory, "index.html"),
      resolve(outputDirectory, "404.html")
    );
  }
};

export default defineConfig({
  base,
  plugins: [
    react(),
    pagesRouteFallback,
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["icons/icon-192.png", "icons/icon-512.png"],
      manifest: {
        name: "工作留痕",
        short_name: "工作留痕",
        description: "个人工作留痕工具",
        lang: "zh-CN",
        start_url: base,
        scope: base,
        display: "standalone",
        theme_color: "#15345b",
        background_color: "#f4f7fb",
        icons: [
          {
            src: "icons/icon-192.png",
            sizes: "192x192",
            type: "image/png",
            purpose: "any"
          },
          {
            src: "icons/icon-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "any maskable"
          }
        ]
      },
      workbox: {
        navigateFallback: "index.html",
        globPatterns: ["**/*.{js,css,html,ico,png,svg,webmanifest}"]
      }
    })
  ],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url))
    }
  }
});

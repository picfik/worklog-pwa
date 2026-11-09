import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        navy: "#15345b",
        canvas: "#f4f7fb"
      }
    }
  },
  plugins: []
} satisfies Config;

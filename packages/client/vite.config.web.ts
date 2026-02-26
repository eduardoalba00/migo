import { resolve } from "path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  root: ".",
  resolve: {
    alias: {
      "@": resolve("src/renderer/src"),
    },
    conditions: ["@migo/source"],
  },
  plugins: [react(), tailwindcss()],
  build: {
    outDir: "dist-web",
  },
});

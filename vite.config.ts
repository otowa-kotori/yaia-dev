import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@core": path.resolve(__dirname, "src/core"),
      "@content": path.resolve(__dirname, "src/content"),
      "@ui": path.resolve(__dirname, "src/ui"),
    },
  },
  server: {
    port: 5173,
  },
});

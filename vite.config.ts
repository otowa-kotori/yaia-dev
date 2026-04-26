import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

function normalizeBasePath(raw: string | undefined): string {
  if (!raw) return "/";
  if (/^https?:\/\//.test(raw)) {
    return raw.endsWith("/") ? raw : `${raw}/`;
  }
  const withLeadingSlash = raw.startsWith("/") ? raw : `/${raw}`;
  return withLeadingSlash.endsWith("/") ? withLeadingSlash : `${withLeadingSlash}/`;
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");

  return {
    base: normalizeBasePath(env.VITE_BASE_PATH),
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
  };
});

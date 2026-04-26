/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_RELEASE_CHANNEL?: "dev" | "stable";
  readonly VITE_ENABLE_DEBUG_PANEL?: "true" | "false";
  readonly VITE_SAVE_NAMESPACE?: string;
  readonly VITE_APP_VERSION?: string;
  readonly VITE_BUILD_SHA?: string;
  readonly VITE_BASE_PATH?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

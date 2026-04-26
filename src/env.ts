import packageJson from "../package.json";

export type ReleaseChannel = "dev" | "stable";

type EnvKey = keyof ImportMetaEnv;

function readEnv(name: EnvKey): string | undefined {
  const value = import.meta.env[name];
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function readBooleanEnv(name: EnvKey, fallback: boolean): boolean {
  const value = readEnv(name);
  if (value === undefined) return fallback;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error(`env: ${String(name)} must be \"true\" or \"false\", got ${value}`);
}

function normalizeReleaseChannel(raw: string): ReleaseChannel {
  if (raw === "dev" || raw === "stable") return raw;
  throw new Error(`env: VITE_RELEASE_CHANNEL must be \"dev\" or \"stable\", got ${raw}`);
}

function normalizeBuildSha(raw: string): string {
  if (raw === "local") return raw;
  return raw.slice(0, 7);
}

export const RELEASE_CHANNEL = normalizeReleaseChannel(
  readEnv("VITE_RELEASE_CHANNEL") ?? (import.meta.env.DEV ? "dev" : "stable"),
);

export const ENABLE_DEBUG_PANEL = readBooleanEnv(
  "VITE_ENABLE_DEBUG_PANEL",
  RELEASE_CHANNEL === "dev",
);

export const SAVE_NAMESPACE = readEnv("VITE_SAVE_NAMESPACE") ?? `yaia:${RELEASE_CHANNEL}`;
export const SAVE_KEY = `${SAVE_NAMESPACE}:save`;
export const APP_VERSION = readEnv("VITE_APP_VERSION") ?? packageJson.version;
export const BUILD_SHA = normalizeBuildSha(readEnv("VITE_BUILD_SHA") ?? "local");

// Balance testing configuration schema, loading, and validation.
//
// Design: profiles and scenarios are decoupled.
// - Profiles file (e.g. profiles/knight.json): stable hero build templates.
// - Scenarios can come from a config file OR be built dynamically from CLI args
//   using glob patterns on profile keys and combat zone IDs.
//
// Simulation length is specified in **simulated minutes** (durationMinutes).
// The engine runs at 10 Hz, so 1 minute = 600 ticks.
// Default: 60 minutes (1 hour of in-game AFK farming).

import type { ContentDb } from "../../src/core/content";

// ---------- Constants ----------

/** Logic ticks per simulated second (10 Hz engine). */
export const TICKS_PER_SECOND = 10;
export const TICKS_PER_MINUTE = TICKS_PER_SECOND * 60;

// ---------- Types ----------

/** A reusable hero build template. */
export interface HeroProfile {
  /** Which hero config to use, e.g. "hero.knight". */
  heroId: string;
  /** Target level (1-based). Default 1. */
  level?: number;
  /** Items to give & auto-equip (gear replaces existing slot). */
  equipment?: string[];
  /** Talent allocation: talentId -> target level (calls allocateTalent N times). */
  talents?: Record<string, number>;
  /** Which active/sustain talents to equip into battle slots. */
  equippedTalents?: string[];
}

/** A test scenario that compares multiple profiles against one combat zone. */
export interface Scenario {
  /** Human-readable scenario name. */
  name: string;
  /** Profile keys to run (references into heroProfiles). Supports glob. */
  profiles: string[];
  /** The combat zone to fight in. Supports glob (expands to multiple scenarios). */
  combatZoneId: string;
  /** Simulated duration in minutes. Overrides defaults. */
  durationMinutes?: number;
}

/** Profiles-only file: just the reusable hero build templates. */
export interface ProfilesFile {
  heroProfiles: Record<string, HeroProfile>;
}

/** Full config file with embedded profiles and scenarios. */
export interface BalanceConfig {
  /** Base RNG seed. Default 42. */
  seed?: number;
  /** Default values for scenarios that don't specify their own. */
  defaults?: {
    durationMinutes?: number;
  };
  /** Reusable hero build templates keyed by profile name. */
  heroProfiles: Record<string, HeroProfile>;
  /** Test scenarios to run. */
  scenarios: Scenario[];
}

/** Resolved scenario with all defaults filled in and globs expanded. */
export interface ResolvedScenario {
  name: string;
  profiles: Array<{ key: string; profile: HeroProfile }>;
  combatZoneId: string;
  /** Total ticks to simulate (derived from durationMinutes). */
  totalTicks: number;
  seed: number;
}

// ---------- Defaults ----------

/** Default simulation: 1 hour of in-game AFK time. */
const DEFAULT_DURATION_MINUTES = 60;
const DEFAULT_SEED = 42;

// ---------- Loading ----------

export async function loadJsonFile<T>(path: string): Promise<T> {
  const file = Bun.file(path);
  if (!(await file.exists())) {
    throw new Error(`file not found: ${path}`);
  }
  return await file.json() as T;
}

export async function loadProfilesFile(path: string): Promise<ProfilesFile> {
  return loadJsonFile<ProfilesFile>(path);
}

export async function loadConfigFile(path: string): Promise<BalanceConfig> {
  return loadJsonFile<BalanceConfig>(path);
}

// ---------- Glob matching ----------

/**
 * Simple glob: * matches any substring within the full string.
 * "knight_lv*" matches "knight_lv1", "knight_lv5_copper", etc.
 * "combatzone.prairie.*" matches "combatzone.prairie.1_1_green_slime".
 */
export function globMatch(pattern: string, value: string): boolean {
  if (!pattern.includes("*")) return pattern === value;
  const regex = new RegExp(
    "^" + pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*") + "$",
  );
  return regex.test(value);
}

/** Expand a list of glob patterns against a set of available keys. */
export function expandGlobs(patterns: string[], available: string[]): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const pattern of patterns) {
    for (const key of available) {
      if (!seen.has(key) && globMatch(pattern, key)) {
        result.push(key);
        seen.add(key);
      }
    }
  }
  return result;
}

// ---------- Validation ----------

export function validateProfiles(
  profiles: Record<string, HeroProfile>,
  content: ContentDb,
): string[] {
  const errors: string[] = [];
  for (const [key, profile] of Object.entries(profiles)) {
    const hero = content.starting?.heroes.find((h) => h.id === profile.heroId);
    if (!hero) {
      errors.push(`heroProfiles.${key}: unknown heroId "${profile.heroId}"`);
    }
    for (const itemId of profile.equipment ?? []) {
      if (!content.items[itemId]) {
        errors.push(`heroProfiles.${key}: unknown item "${itemId}"`);
      }
    }
    for (const talentId of Object.keys(profile.talents ?? {})) {
      if (!content.talents[talentId]) {
        errors.push(`heroProfiles.${key}: unknown talent "${talentId}"`);
      }
    }
    for (const talentId of profile.equippedTalents ?? []) {
      if (!content.talents[talentId]) {
        errors.push(`heroProfiles.${key}: unknown equipped talent "${talentId}"`);
      }
    }
  }
  return errors;
}

export function validateConfig(config: BalanceConfig, content: ContentDb): string[] {
  const errors = validateProfiles(config.heroProfiles, content);

  for (const scenario of config.scenarios) {
    if (!scenario.name) {
      errors.push(`scenario: missing name`);
    }
    const zones = expandGlobs(
      [scenario.combatZoneId],
      Object.keys(content.combatZones),
    );
    if (zones.length === 0) {
      errors.push(
        `scenario "${scenario.name}": no combatZones matched "${scenario.combatZoneId}"`,
      );
    }
    const profileKeys = expandGlobs(
      scenario.profiles,
      Object.keys(config.heroProfiles),
    );
    if (profileKeys.length === 0) {
      errors.push(
        `scenario "${scenario.name}": no profiles matched ${JSON.stringify(scenario.profiles)}`,
      );
    }
  }
  return errors;
}

// ---------- Resolution ----------

export function resolveScenarios(
  config: BalanceConfig,
  content: ContentDb,
): ResolvedScenario[] {
  const baseSeed = config.seed ?? DEFAULT_SEED;
  const defaultDuration = config.defaults?.durationMinutes ?? DEFAULT_DURATION_MINUTES;
  const allProfileKeys = Object.keys(config.heroProfiles);
  const allZoneIds = Object.keys(content.combatZones);

  const result: ResolvedScenario[] = [];

  for (const s of config.scenarios) {
    const profileKeys = expandGlobs(s.profiles, allProfileKeys);
    const zoneIds = expandGlobs([s.combatZoneId], allZoneIds);
    const duration = s.durationMinutes ?? defaultDuration;

    for (const zoneId of zoneIds) {
      const zoneName = content.combatZones[zoneId]?.name ?? zoneId;
      const name =
        zoneIds.length === 1 ? s.name : `${s.name} [${zoneName}]`;

      result.push({
        name,
        profiles: profileKeys.map((key) => ({
          key,
          profile: config.heroProfiles[key]!,
        })),
        combatZoneId: zoneId,
        totalTicks: duration * TICKS_PER_MINUTE,
        seed: baseSeed,
      });
    }
  }

  return result;
}

// ---------- CLI-driven scenario builder ----------

export function buildCliConfig(
  profiles: Record<string, HeroProfile>,
  opts: {
    profileGlobs: string[];
    zoneGlobs: string[];
    durationMinutes?: number;
    seed?: number;
  },
): BalanceConfig {
  return {
    seed: opts.seed ?? DEFAULT_SEED,
    defaults: {
      durationMinutes: opts.durationMinutes ?? DEFAULT_DURATION_MINUTES,
    },
    heroProfiles: profiles,
    scenarios: opts.zoneGlobs.map((zoneGlob) => ({
      name: `${opts.profileGlobs.join("+")} vs ${zoneGlob}`,
      profiles: opts.profileGlobs,
      combatZoneId: zoneGlob,
    })),
  };
}

// ---------- Quick-mode config builder ----------

export interface QuickOptions {
  heroId: string;
  combatZoneId: string;
  level?: number;
  weapon?: string;
  durationMinutes?: number;
  seed?: number;
}

export function buildQuickConfig(opts: QuickOptions): BalanceConfig {
  const equipment = opts.weapon ? [opts.weapon] : [];
  const profileKey = "quick";

  return {
    seed: opts.seed ?? DEFAULT_SEED,
    defaults: {
      durationMinutes: opts.durationMinutes ?? DEFAULT_DURATION_MINUTES,
    },
    heroProfiles: {
      [profileKey]: {
        heroId: opts.heroId,
        level: opts.level,
        equipment,
      },
    },
    scenarios: [
      {
        name: `${opts.heroId} Lv${opts.level ?? 1} vs ${opts.combatZoneId}`,
        profiles: [profileKey],
        combatZoneId: opts.combatZoneId,
      },
    ],
  };
}

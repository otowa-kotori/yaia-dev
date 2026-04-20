// Attribute system.
//
// An AttrSet holds per-unit base values plus a flat list of Modifier entries.
// `recomputeAttrs` folds the list into a final numeric value per stat using:
//
//   final = (base + Σflat) * (1 + Σpct_add) * Π(1 + pct_mult)
//   then clamp to [clampMin, clampMax] (from AttrDef)
//   then floor to int if AttrDef.integer
//
// Default new modifiers to `pct_add`. `pct_mult` is reserved for rare bonuses
// (e.g. set effects) — stacking multiple +10% mults compounds quickly.
//
// Modifiers carry a sourceId so they can be removed cleanly when an item is
// unequipped or a buff expires. NEVER mutate modifiers after insertion; always
// remove + re-add.

import type { AttrDef, AttrId, Modifier } from "../content/types";

export interface AttrSet {
  /** Base values keyed by AttrId. Missing entries default to AttrDef.defaultBase. */
  base: Record<string, number>;
  /** All active modifiers (from gear, buffs, talents, etc). Append-only at insert, filtered at removal. */
  modifiers: Modifier[];
  /** Cached final values. null means dirty / not yet computed. */
  cache: Record<string, number> | null;
}

export function createAttrSet(base: Record<string, number> = {}): AttrSet {
  return {
    base: { ...base },
    modifiers: [],
    cache: null,
  };
}

/** Append modifiers and invalidate cache. */
export function addModifiers(set: AttrSet, mods: readonly Modifier[]): void {
  if (mods.length === 0) return;
  for (const m of mods) set.modifiers.push(m);
  set.cache = null;
}

/** Remove all modifiers whose sourceId matches. Returns the number removed. */
export function removeModifiersBySource(set: AttrSet, sourceId: string): number {
  const before = set.modifiers.length;
  set.modifiers = set.modifiers.filter((m) => m.sourceId !== sourceId);
  const removed = before - set.modifiers.length;
  if (removed > 0) set.cache = null;
  return removed;
}

/** Force a recompute. Normally you don't call this directly — getAttr does it. */
export function recomputeAttrs(
  set: AttrSet,
  attrDefs: Readonly<Record<string, AttrDef>>,
): void {
  const result: Record<string, number> = {};

  // Prime result with base values (including defaults from AttrDef).
  for (const id of Object.keys(attrDefs)) {
    const def = attrDefs[id]!;
    result[id] = set.base[id] ?? def.defaultBase;
  }
  // Also honor any base-only stats the unit defines but the AttrDef doesn't know about.
  for (const id of Object.keys(set.base)) {
    if (!(id in result)) result[id] = set.base[id]!;
  }

  // Accumulate flat / pct_add / pct_mult buckets per stat.
  const flat: Record<string, number> = {};
  const pctAdd: Record<string, number> = {};
  const pctMult: Record<string, number> = {};

  for (const m of set.modifiers) {
    switch (m.op) {
      case "flat":
        flat[m.stat] = (flat[m.stat] ?? 0) + m.value;
        break;
      case "pct_add":
        pctAdd[m.stat] = (pctAdd[m.stat] ?? 0) + m.value;
        break;
      case "pct_mult":
        // Store as Σln(1+v) so we can multiply by exp()? No — just multiply directly below.
        pctMult[m.stat] = (pctMult[m.stat] ?? 1) * (1 + m.value);
        break;
    }
  }

  for (const id of Object.keys(result)) {
    let v = result[id]!;
    v = (v + (flat[id] ?? 0)) * (1 + (pctAdd[id] ?? 0)) * (pctMult[id] ?? 1);

    const def = attrDefs[id];
    if (def) {
      if (def.clampMin !== undefined && v < def.clampMin) v = def.clampMin;
      if (def.clampMax !== undefined && v > def.clampMax) v = def.clampMax;
      if (def.integer) v = Math.floor(v);
    }
    result[id] = v;
  }

  set.cache = result;
}

/** Read one stat. Triggers a recompute if the cache is dirty. */
export function getAttr(
  set: AttrSet,
  attrId: AttrId | string,
  attrDefs: Readonly<Record<string, AttrDef>>,
): number {
  if (set.cache === null) recomputeAttrs(set, attrDefs);
  const v = set.cache![attrId];
  if (v !== undefined) return v;
  // Unknown attr: return the AttrDef default or 0.
  const def = attrDefs[attrId];
  return def?.defaultBase ?? 0;
}

/** Force the cache to be rebuilt on next read. Call after base mutations. */
export function invalidateAttrs(set: AttrSet): void {
  set.cache = null;
}

// ---------- Canonical attribute IDs (MVP) ----------
//
// These are the attribute IDs the default game content uses. Branded as
// AttrId at the type level so computed-property keys on Record<AttrId, _>
// keep their brand at call sites. Content registry is still the source of
// truth for AttrDef — this is just naming.

export const ATTR = {
  MAX_HP: "attr.max_hp" as AttrId,
  MAX_MP: "attr.max_mp" as AttrId,
  ATK: "attr.atk" as AttrId,
  DEF: "attr.def" as AttrId,
  STR: "attr.str" as AttrId,
  DEX: "attr.dex" as AttrId,
  INT: "attr.int" as AttrId,
  WIS: "attr.wis" as AttrId,
  CRIT_RATE: "attr.crit_rate" as AttrId,
  CRIT_MULT: "attr.crit_mult" as AttrId,
  SPEED: "attr.speed" as AttrId,
} as const;

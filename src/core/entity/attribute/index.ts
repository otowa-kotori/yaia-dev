// Attribute system.
//
// An AttrSet holds per-unit base values plus a flat list of Modifier entries.
// `recomputeStat` folds the list into a final numeric value for a single stat:
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
//
// Cache strategy: per-stat lazy invalidation.
//   - cache is always a Record (never null). A missing key means that stat is
//     dirty and will be recomputed on the next getAttr call.
//   - addModifiers / removeModifiersBySource delete only the keys for the
//     affected stats, leaving untouched stats' cached values intact.
//   - invalidateAttrs / recomputeAttrs reset the whole cache (base mutations,
//     load from save, explicit full rebuild).

import type { AttrDef, AttrId, Modifier } from "../../content/types";

export interface AttrSet {
  /** Base values keyed by AttrId. Missing entries default to AttrDef.defaultBase. */
  base: Record<string, number>;
  /** All active modifiers (from gear, buffs, talents, etc). Append-only at insert, filtered at removal. */
  modifiers: Modifier[];
  /** Cached final values. A missing key means that stat is dirty and will be
   *  lazily recomputed by getAttr. Never null — use {} for "all dirty". */
  cache: Record<string, number>;
}

export function createAttrSet(base: Record<string, number> = {}): AttrSet {
  return {
    base: { ...base },
    modifiers: [],
    cache: {},  // all stats start dirty; computed on first getAttr
  };
}

/** Append modifiers, invalidating only the stats they affect. */
export function addModifiers(set: AttrSet, mods: readonly Modifier[]): void {
  if (mods.length === 0) return;
  for (const m of mods) {
    set.modifiers.push(m);
    delete set.cache[m.stat];  // only this stat is now dirty
  }
}

/** Remove all modifiers whose sourceId matches. Invalidates only affected stats.
 *  Returns the number of modifiers removed. */
export function removeModifiersBySource(set: AttrSet, sourceId: string): number {
  const removed = set.modifiers.filter((m) => m.sourceId === sourceId);
  if (removed.length === 0) return 0;
  set.modifiers = set.modifiers.filter((m) => m.sourceId !== sourceId);
  for (const m of removed) delete set.cache[m.stat];
  return removed.length;
}

// ---------- Internal: recompute a single stat ----------

function recomputeStat(
  set: AttrSet,
  attrId: string,
  attrDefs: Readonly<Record<string, AttrDef>>,
): void {
  const def = attrDefs[attrId];
  const base = set.base[attrId] ?? def?.defaultBase ?? 0;

  let flat = 0, pctAdd = 0, pctMult = 1;
  for (const m of set.modifiers) {
    if (m.stat !== attrId) continue;
    switch (m.op) {
      case "flat":     flat += m.value; break;
      case "pct_add":  pctAdd += m.value; break;
      // Store as Σln(1+v) so we can multiply by exp()? No — just multiply directly.
      case "pct_mult": pctMult *= (1 + m.value); break;
    }
  }

  let v = (base + flat) * (1 + pctAdd) * pctMult;
  if (def) {
    if (def.clampMin !== undefined && v < def.clampMin) v = def.clampMin;
    if (def.clampMax !== undefined && v > def.clampMax) v = def.clampMax;
    if (def.integer) v = Math.floor(v);
  }
  set.cache[attrId] = v;
}

// ---------- Public API ----------

/** Read one stat. Recomputes only if this stat's cache key is missing (dirty). */
export function getAttr(
  set: AttrSet,
  attrId: AttrId | string,
  attrDefs: Readonly<Record<string, AttrDef>>,
): number {
  if (!(attrId in set.cache)) recomputeStat(set, attrId, attrDefs);
  const v = set.cache[attrId];
  if (v !== undefined) return v;
  // Unknown attr with no base entry and no AttrDef: return 0.
  return attrDefs[attrId]?.defaultBase ?? 0;
}

/** Force all stats dirty. Call after bulk base mutations or on load.
 *  Individual reads will lazily recompute on demand. */
export function invalidateAttrs(set: AttrSet): void {
  set.cache = {};
}

/** Eagerly recompute all known stats (AttrDef keys + base keys + modifier
 *  stats). Useful for load/debug paths that want a fully warm cache. */
export function recomputeAttrs(
  set: AttrSet,
  attrDefs: Readonly<Record<string, AttrDef>>,
): void {
  // Collect the full universe of stat ids this unit might expose.
  const allStats = new Set<string>([
    ...Object.keys(attrDefs),
    ...Object.keys(set.base),
    ...set.modifiers.map((m) => m.stat),
  ]);
  set.cache = {};
  for (const stat of allStats) recomputeStat(set, stat, attrDefs);
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
  INVENTORY_STACK_LIMIT: "attr.inventory_stack_limit" as AttrId,
} as const;

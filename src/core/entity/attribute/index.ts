// Attribute system.
//
// An AttrSet holds per-unit base values plus a flat list of Modifier entries
// (static) and DynamicModifierProvider entries (runtime, not persisted).
// `recomputeStat` folds everything into a final numeric value for one stat:
//
//   final = (base + Σflat) * (1 + Σpct_add) * Π(1 + pct_mult)
//   then clamp to [clampMin, clampMax] (from AttrDef)
//   then round to int if AttrDef.integer
//
// Two reactive capabilities extend the original static model:
//
//   1. Derived base (AttrDef.computeBase): a function that reads other attrs
//      via get() instead of using set.base[id]. E.g. PATK = f(STR, WEAPON_ATK).
//   2. Dynamic modifiers (DynamicModifierProvider): modifier values computed
//      at query time by calling provider.compute(get). E.g. "heal power scales
//      with INT" talent effects.
//
// Both use lazy invalidation. When a stat's cache is cleared, invalidateStat()
// propagates the invalidation through depGraph to all dependent stats, so the
// next getAttr on any downstream stat triggers a fresh recompute.
//
// Circular dependency detection: recomputeStat tracks which stats are currently
// being computed in the module-level `recomputing` Set. If a cycle is detected,
// an error is thrown immediately (alpha: loud failure, no silent fallback).
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
//   - addModifiers / removeModifiersBySource call invalidateStat which deletes
//     the cache key and propagates via depGraph to dependents.
//   - invalidateAttrs / recomputeAttrs reset the whole cache (base mutations,
//     load from save, explicit full rebuild).
//
// Persistence: dynamicProviders and depGraph are NOT persisted. They are
// rebuilt by rebuildCharacterDerived after load, same as modifiers and cache.

import type { AttrDef, AttrId, DynamicModifierProvider, Modifier } from "../../content/types";

export interface AttrSet {
  /** Base values keyed by AttrId. Missing entries default to AttrDef.defaultBase. */
  base: Record<string, number>;
  /** All active static modifiers (from gear, buffs, talents, etc). Append-only at insert, filtered at removal. */
  modifiers: Modifier[];
  /** Cached final values. A missing key means that stat is dirty and will be
   *  lazily recomputed by getAttr. Never null — use {} for "all dirty". */
  cache: Record<string, number>;
  /** Dynamic modifier providers. recomputeStat calls each provider's compute()
   *  to fold in modifier values that depend on other live attributes.
   *  Not persisted — rebuilt by rebuildCharacterDerived on load. */
  dynamicProviders: DynamicModifierProvider[];
  /** Reverse dependency graph: stat → set of stats that depend on it.
   *  Built from AttrDef.dependsOn + DynamicModifierProvider.dependsOn.
   *  Not persisted — rebuilt by rebuildDepGraph after load and after
   *  addDynamicProvider / removeDynamicProvider. */
  depGraph: Record<string, Set<string>>;
}

export function createAttrSet(base: Record<string, number> = {}): AttrSet {
  return {
    base: { ...base },
    modifiers: [],
    cache: {},  // all stats start dirty; computed on first getAttr
    dynamicProviders: [],
    depGraph: {},
  };
}

// ---------- Internal: invalidation ----------

/**
 * Recursively invalidate a stat and all its downstream dependents.
 * Early-returns if stat is already dirty (missing from cache) to avoid
 * redundant traversal when multiple modifiers touch the same upstream stat.
 */
function invalidateStat(set: AttrSet, stat: string): void {
  if (!(stat in set.cache)) return;   // already dirty, dependents already propagated
  delete set.cache[stat];
  const dependents = set.depGraph[stat];
  if (dependents) {
    for (const dep of dependents) {
      invalidateStat(set, dep);
    }
  }
}

/** Append modifiers, invalidating the affected stats and their dependents. */
export function addModifiers(set: AttrSet, mods: readonly Modifier[]): void {
  if (mods.length === 0) return;
  for (const m of mods) {
    set.modifiers.push(m);
    invalidateStat(set, m.stat);
  }
}

/** Remove all modifiers whose sourceId matches. Invalidates affected stats
 *  and their dependents. Returns the number of modifiers removed. */
export function removeModifiersBySource(set: AttrSet, sourceId: string): number {
  const removed = set.modifiers.filter((m) => m.sourceId === sourceId);
  if (removed.length === 0) return 0;
  set.modifiers = set.modifiers.filter((m) => m.sourceId !== sourceId);
  for (const m of removed) invalidateStat(set, m.stat);
  return removed.length;
}

// ---------- Internal: recompute a single stat ----------

/** Tracks attrs currently being recomputed. Module-level so the chain
 *  spanning multiple getAttr→recomputeStat calls can be detected.
 *  Alpha: single-threaded only (web worker would need per-chain passing). */
const recomputing = new Set<string>();

function recomputeStat(
  set: AttrSet,
  attrId: string,
  attrDefs: Readonly<Record<string, AttrDef>>,
): void {
  // ---- Cycle detection ----
  if (recomputing.has(attrId)) {
    throw new Error(`Circular attr dependency: ${attrId}`);
  }
  recomputing.add(attrId);

  try {
    const def = attrDefs[attrId];
    const get = (id: AttrId) => getAttr(set, id, attrDefs);

    // ---- base: derived via computeBase, or static from set.base / defaultBase ----
    const base = def?.computeBase
      ? def.computeBase(get)
      : set.base[attrId] ?? def?.defaultBase ?? 0;

    let flat = 0, pctAdd = 0, pctMult = 1;

    // ---- Static modifiers (unchanged from original) ----
    for (const m of set.modifiers) {
      if (m.stat !== attrId) continue;
      switch (m.op) {
        case "flat":     flat += m.value; break;
        case "pct_add":  pctAdd += m.value; break;
        // Store as Σln(1+v) so we can multiply by exp()? No — just multiply directly.
        case "pct_mult": pctMult *= (1 + m.value); break;
      }
    }

    // ---- Dynamic modifiers (new): fold in each provider's computed output ----
    for (const provider of set.dynamicProviders) {
      if (!provider.targetAttrs.includes(attrId as AttrId)) continue;
      const mods = provider.compute(get);
      for (const m of mods) {
        if (m.stat !== attrId) continue;
        switch (m.op) {
          case "flat":     flat += m.value; break;
          case "pct_add":  pctAdd += m.value; break;
          case "pct_mult": pctMult *= (1 + m.value); break;
        }
      }
    }

    let v = (base + flat) * (1 + pctAdd) * pctMult;
    if (def) {
      if (def.clampMin !== undefined && v < def.clampMin) v = def.clampMin;
      if (def.clampMax !== undefined && v > def.clampMax) v = def.clampMax;
      if (def.integer) v = Math.round(v);
    }
    set.cache[attrId] = v;
  } finally {
    recomputing.delete(attrId);
  }
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
 *  stats + dynamic provider target stats). Useful for load/debug paths
 *  that want a fully warm cache. */
export function recomputeAttrs(
  set: AttrSet,
  attrDefs: Readonly<Record<string, AttrDef>>,
): void {
  // Collect the full universe of stat ids this unit might expose.
  const allStats = new Set<string>([
    ...Object.keys(attrDefs),
    ...Object.keys(set.base),
    ...set.modifiers.map((m) => m.stat),
    ...set.dynamicProviders.flatMap((p) => p.targetAttrs),
  ]);
  set.cache = {};
  for (const stat of allStats) recomputeStat(set, stat, attrDefs);
}

// ---------- depGraph management ----------

/**
 * Rebuild the full depGraph from AttrDef.dependsOn edges and
 * DynamicModifierProvider.dependsOn edges. Call after load or after
 * removeDynamicProvider (when incremental removal is not safe).
 */
export function rebuildDepGraph(
  set: AttrSet,
  attrDefs: Readonly<Record<string, AttrDef>>,
): void {
  set.depGraph = {};
  // Edges from AttrDef.dependsOn (derived bases)
  for (const def of Object.values(attrDefs)) {
    if (def.dependsOn) {
      for (const dep of def.dependsOn) {
        (set.depGraph[dep] ??= new Set()).add(def.id);
      }
    }
  }
  // Edges from DynamicModifierProvider.dependsOn
  for (const p of set.dynamicProviders) {
    for (const dep of p.dependsOn) {
      for (const target of p.targetAttrs) {
        (set.depGraph[dep] ??= new Set()).add(target);
      }
    }
  }
}

/**
 * Install a dynamic modifier provider. Incrementally updates depGraph,
 * then invalidates target attributes so the next getAttr will recompute.
 */
export function addDynamicProvider(
  set: AttrSet,
  provider: DynamicModifierProvider,
  attrDefs: Readonly<Record<string, AttrDef>>,
): void {
  set.dynamicProviders.push(provider);
  // Incremental depGraph update (add edges only for this provider)
  for (const dep of provider.dependsOn) {
    for (const target of provider.targetAttrs) {
      (set.depGraph[dep] ??= new Set()).add(target);
    }
  }
  // Mark target attrs dirty so they recompute on next read
  for (const t of provider.targetAttrs) {
    invalidateStat(set, t);
  }
}

/**
 * Remove a dynamic modifier provider by sourceId. Invalidates its target
 * attributes, then does a full depGraph rebuild (provider count is small,
 * and incremental removal can't safely tell if an edge still has other sources).
 */
export function removeDynamicProvider(
  set: AttrSet,
  sourceId: string,
  attrDefs: Readonly<Record<string, AttrDef>>,
): void {
  const idx = set.dynamicProviders.findIndex((p) => p.sourceId === sourceId);
  if (idx < 0) return;
  // idx is valid (findIndex returned it); non-null assertion is safe here.
  const provider = set.dynamicProviders[idx]!;
  set.dynamicProviders.splice(idx, 1);
  // Mark target attrs dirty before rebuilding graph
  for (const t of provider.targetAttrs) {
    invalidateStat(set, t);
  }
  // Full rebuild: safe because provider count is small (~few per character)
  rebuildDepGraph(set, attrDefs);
}

// ---------- Canonical attribute IDs (MVP) ----------
//
// These are the attribute IDs the default game content uses. Branded as
// AttrId at the type level so computed-property keys on Record<AttrId, _>
// keep their brand at call sites. Content registry is still the source of
// truth for AttrDef — this is just naming.
//
// 属性分层：
//   一级属性层: STR / DEX / INT / CON
//   聚合层:     PHYS_POTENCY / MAG_POTENCY（由 DynamicModifierProvider 汇聚一级属性）
//   面板层:     PATK / MATK（由 computeBase 读取武器 + 聚合层计算）
//   防御层:     PDEF（装备 flat）/ MRES（百分比，上限 0.8）
//   武器层:     WEAPON_ATK / WEAPON_MATK（装备 flat，赤手默认值 1 / 0）
//   命中层:     HIT / EVA（由 DEX DynamicModifierProvider 驱动）
//   暴击层:     CRIT_RATE / CRIT_RES（由 DEX DynamicModifierProvider 驱动）
//
// ATK 和 DEF 已退役，由 PATK/MATK/PDEF/MRES 取代。
// WIS 已退役，牧师/圣女共用 INT。

export const ATTR = {
  MAX_HP:  "attr.max_hp"  as AttrId,
  MAX_MP:  "attr.max_mp"  as AttrId,
  HP_REGEN: "attr.hp_regen" as AttrId,
  MP_REGEN: "attr.mp_regen" as AttrId,
  OUT_OF_COMBAT_HP_PCT_PER_SECOND: "attr.out_of_combat_hp_pct_per_second" as AttrId,
  OUT_OF_COMBAT_MP_PCT_PER_SECOND: "attr.out_of_combat_mp_pct_per_second" as AttrId,
  STR:     "attr.str"     as AttrId,
  DEX:     "attr.dex"     as AttrId,
  INT:     "attr.int"     as AttrId,
  CON:     "attr.con"     as AttrId,
  SPEED:   "attr.speed"   as AttrId,

  // 武器基础值
  WEAPON_ATK:  "attr.weapon_atk"  as AttrId,
  WEAPON_MATK: "attr.weapon_matk" as AttrId,

  // 聚合层（由 DynamicModifierProvider 驱动，defaultBase = 0）
  PHYS_POTENCY: "attr.phys_potency" as AttrId,
  MAG_POTENCY:  "attr.mag_potency"  as AttrId,

  // 面板攻击力（computeBase 派生）
  PATK: "attr.patk" as AttrId,
  MATK: "attr.matk" as AttrId,

  // 防御
  PDEF: "attr.pdef" as AttrId,
  MRES: "attr.mres" as AttrId,  // 百分比减伤，0.0–0.8

  // 命中 / 闪避（由 DEX 通过 UNIVERSAL_SCALING 驱动）
  HIT: "attr.hit" as AttrId,
  EVA: "attr.eva" as AttrId,

  // 暴击（CRIT_RATE 由 DEX 驱动，是原始评级值而非概率；
  //        CRIT_RES 是防守侧暴击抗性评级）
  CRIT_RATE:  "attr.crit_rate"  as AttrId,
  CRIT_RES:   "attr.crit_res"   as AttrId,
  CRIT_MULT:  "attr.crit_mult"  as AttrId,
  INVENTORY_STACK_LIMIT: "attr.inventory_stack_limit" as AttrId,

  // 仇恨权重 — 被选为攻击目标的相对概率，默认 1.0。
  // 战吼 buff 临时提升该值，Intent 按此加权随机 pick 目标。
  AGGRO_WEIGHT: "attr.aggro_weight" as AttrId,

  // 技能装备槽上限 — 决定角色可以装备多少个主动/sustain 技能。
  // 基础攻击不占槽。默认 3，可通过升级系统提升。
  TALENT_SLOTS: "attr.talent_slots" as AttrId,
} as const;

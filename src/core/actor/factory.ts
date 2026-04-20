// Actor factories + derived-state rebuild.
//
// Rules:
// - Factories produce a fully-populated Actor including derived fields.
// - rebuildCharacterDerived(c) clears and re-derives attrs.modifiers /
//   attrs.cache / abilities from the character's persisted SoT (equipped gear,
//   activeEffects, knownAbilities). Call this:
//     * after loading a save
//     * after equipping/unequipping gear
//     * after an effect is applied/removed (effect pipeline does this)
// - attrs.base is PERSISTED. Modifiers/cache/derived ability list are NOT.

import type { AbilityId, AttrDef, MonsterDef } from "../content/types";
import { getEffect, getItem } from "../content/registry";
import type { FormulaRef } from "../formula/types";
import {
  addModifiers,
  createAttrSet,
  getAttr as getAttrFromSet,
  invalidateAttrs,
  type AttrSet,
} from "../attribute";
import type {
  Character,
  Enemy,
  PlayerCharacter,
  Side,
} from "./types";

// ---------- PlayerCharacter factory ----------

export interface CreatePlayerOptions {
  id: string;
  name: string;
  level?: number;
  exp?: number;
  /** XP curve this character levels up with. Required — no fallback. */
  xpCurve: FormulaRef;
  maxLevel?: number;
  baseAttrs?: AttrSet["base"];
  /** Abilities the player has learned. First entry becomes default attack. */
  knownAbilities?: AbilityId[];
  skills?: PlayerCharacter["skills"];
  equipped?: PlayerCharacter["equipped"];
  talents?: string[];
  attrDefs: Readonly<Record<string, AttrDef>>;
}

export function createPlayerCharacter(opts: CreatePlayerOptions): PlayerCharacter {
  const pc: PlayerCharacter = {
    id: opts.id,
    name: opts.name,
    kind: "player",
    level: opts.level ?? 1,
    exp: opts.exp ?? 0,
    xpCurve: opts.xpCurve,
    maxLevel: opts.maxLevel ?? 99,
    skills: opts.skills ?? ({} as PlayerCharacter["skills"]),
    equipped: opts.equipped ?? {},
    talents: opts.talents ?? [],
    activity: null,
    knownAbilities: opts.knownAbilities ?? [],
    currentHp: 0, // set below after attrs computed
    currentMp: 0,
    activeEffects: [],
    cooldowns: {},
    attrs: createAttrSet(opts.baseAttrs ?? {}),
    abilities: [],
    side: "player",
  };
  rebuildCharacterDerived(pc, opts.attrDefs);
  pc.currentHp = getAttrFromSet(pc.attrs, "attr.max_hp", opts.attrDefs);
  pc.currentMp = getAttrFromSet(pc.attrs, "attr.max_mp", opts.attrDefs);
  return pc;
}

// ---------- Enemy factory ----------

export interface CreateEnemyOptions {
  /** Unique per-battle instance id (e.g. "enemy.slime#3"). */
  instanceId: string;
  def: MonsterDef;
  attrDefs: Readonly<Record<string, AttrDef>>;
  side?: Side;
}

export function createEnemy(opts: CreateEnemyOptions): Enemy {
  const base: AttrSet["base"] = {};
  for (const [k, v] of Object.entries(opts.def.baseAttrs)) {
    if (typeof v === "number") base[k] = v;
  }
  const e: Enemy = {
    id: opts.instanceId,
    name: opts.def.name,
    kind: "enemy",
    defId: opts.def.id,
    currentHp: 0,
    currentMp: 0,
    activeEffects: [],
    cooldowns: {},
    attrs: createAttrSet(base),
    abilities: opts.def.abilities.slice(),
    side: opts.side ?? "enemy",
  };
  rebuildCharacterDerived(e, opts.attrDefs);
  e.currentHp = getAttrFromSet(e.attrs, "attr.max_hp", opts.attrDefs);
  e.currentMp = getAttrFromSet(e.attrs, "attr.max_mp", opts.attrDefs);
  return e;
}

// ---------- Derived-state rebuild ----------

/**
 * Rebuild derived fields on a Character (modifier stack + attrs cache +
 * runtime ability list). Persisted fields (attrs.base, currentHp/Mp,
 * activeEffects, cooldowns, equipped, knownAbilities) are the only inputs.
 *
 * Safe to call repeatedly. Clamps currentHp/Mp against the freshly computed
 * maxHp/maxMp (guards against max being lowered between saves).
 */
export function rebuildCharacterDerived(
  c: Character,
  attrDefs: Readonly<Record<string, AttrDef>>,
): void {
  // 1) Wipe modifier stack and cache.
  c.attrs.modifiers = [];
  invalidateAttrs(c.attrs);

  // 2) Equipped-item modifiers (players only).
  if (c.kind === "player") {
    const pc = c as PlayerCharacter;
    for (const [slot, itemId] of Object.entries(pc.equipped)) {
      if (!itemId) continue;
      const item = safeGetItem(itemId);
      if (!item?.modifiers) continue;
      addModifiers(
        c.attrs,
        item.modifiers.map((m) => ({ ...m, sourceId: `equip:${slot}` })),
      );
    }
  }

  // 3) Active-effect modifiers.
  for (const ae of c.activeEffects) {
    const eff = safeGetEffect(ae.effectId);
    if (!eff?.modifiers?.length) continue;
    addModifiers(
      c.attrs,
      eff.modifiers.map((m) => ({ ...m, sourceId: ae.sourceId })),
    );
  }

  // 4) Runtime ability list.
  if (c.kind === "player") {
    c.abilities = (c as PlayerCharacter).knownAbilities.slice();
  } else if (c.kind === "enemy") {
    // Enemy abilities already populated at create time from def; leave as-is
    // unless the caller cleared them. This keeps post-load enemies working.
    if (!c.abilities || c.abilities.length === 0) {
      // Caller should have set from MonsterDef. Nothing we can do here without
      // def lookup; stays empty, which is a visible failure.
    }
  }

  // 5) Cache is now dirty (invalidateAttrs above did it); clamp HP/MP.
  const maxHp = getAttrFromSet(c.attrs, "attr.max_hp", attrDefs);
  const maxMp = getAttrFromSet(c.attrs, "attr.max_mp", attrDefs);
  if (c.currentHp > maxHp) c.currentHp = maxHp;
  if (c.currentHp < 0) c.currentHp = 0;
  if (c.currentMp > maxMp) c.currentMp = maxMp;
  if (c.currentMp < 0) c.currentMp = 0;
}

// ---------- Convenience ----------

export function getAttr(
  c: Character,
  attrId: string,
  attrDefs: Readonly<Record<string, AttrDef>>,
): number {
  return getAttrFromSet(c.attrs, attrId, attrDefs);
}

// ---------- Internal ----------

function safeGetItem(id: string) {
  try {
    return getItem(id);
  } catch {
    return undefined;
  }
}

function safeGetEffect(id: string) {
  try {
    return getEffect(id);
  } catch {
    return undefined;
  }
}

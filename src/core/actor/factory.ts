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
import { getContent, getEffect, getItem } from "../content/registry";
import type { FormulaRef } from "../formula/types";
import {
  addModifiers,
  ATTR,
  createAttrSet,
  getAttr as getAttrFromSet,
  invalidateAttrs,
  type AttrSet,
} from "../attribute";
import type {
  Character,
  Enemy,
  PlayerCharacter,
  ResourceNode,
  Side,
} from "./types";
import type { ResourceNodeDef } from "../content/types";
import type { WorldRecord } from "../state/types";
import { computeWorldModifiers } from "../worldrecord";

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
  inventoryStackLimit?: number;
  attrDefs: Readonly<Record<string, AttrDef>>;
}

export function createPlayerCharacter(opts: CreatePlayerOptions): PlayerCharacter {
  const baseAttrs = { ...(opts.baseAttrs ?? {}) };
  if (opts.inventoryStackLimit !== undefined) {
    if (!Number.isInteger(opts.inventoryStackLimit) || opts.inventoryStackLimit <= 0) {
      throw new Error(
        `createPlayerCharacter: invalid inventoryStackLimit ${opts.inventoryStackLimit}`,
      );
    }
    baseAttrs[ATTR.INVENTORY_STACK_LIMIT] = opts.inventoryStackLimit;
  }

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
    attrs: createAttrSet(baseAttrs),
    abilities: [],
    side: "player",
  };
  rebuildCharacterDerived(pc, opts.attrDefs);
  pc.currentHp = getAttrFromSet(pc.attrs, ATTR.MAX_HP, opts.attrDefs);
  pc.currentMp = getAttrFromSet(pc.attrs, ATTR.MAX_MP, opts.attrDefs);
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
  e.currentHp = getAttrFromSet(e.attrs, ATTR.MAX_HP, opts.attrDefs);
  e.currentMp = getAttrFromSet(e.attrs, ATTR.MAX_MP, opts.attrDefs);
  return e;
}

// ---------- ResourceNode factory ----------

export interface CreateResourceNodeOptions {
  /** Stable world-unique id (e.g. "node.copper_vein.1"). */
  instanceId: string;
  def: ResourceNodeDef;
}

export function createResourceNode(
  opts: CreateResourceNodeOptions,
): ResourceNode {
  return {
    id: opts.instanceId,
    name: opts.def.name,
    kind: "resource_node",
    defId: opts.def.id,
  };
}

// ---------- Derived-state rebuild ----------

/**
 * Rebuild derived fields on a Character (modifier stack + attrs cache +
 * runtime ability list). Persisted fields (attrs.base, currentHp/Mp,
 * activeEffects, cooldowns, equipped, knownAbilities) are the only inputs.
 *
 * Safe to call repeatedly. Clamps currentHp/Mp against the freshly computed
 * maxHp/maxMp (guards against max being lowered between saves).
 *
 * Pass `worldRecord` when rebuilding a PlayerCharacter after a save load or
 * after purchasing a global upgrade — it injects the world-level modifiers.
 * Omitting it (or passing undefined) is correct for Enemies and for the
 * initial character-creation call before WorldRecord exists.
 */
export function rebuildCharacterDerived(
  c: Character,
  attrDefs: Readonly<Record<string, AttrDef>>,
  worldRecord?: WorldRecord,
): void {
  // 1) Wipe modifier stack and cache.
  c.attrs.modifiers = [];
  invalidateAttrs(c.attrs);

  // 2) Equipped-item modifiers (players only). Each slot holds a GearInstance
  //    whose final modifier set is the ItemDef baseline (def.modifiers) plus
  //    per-instance rolledMods. sourceId is tagged with instanceId so we can
  //    revoke one specific piece of gear cleanly in the future.
  if (c.kind === "player") {
    const pc = c as PlayerCharacter;
    for (const [slot, gear] of Object.entries(pc.equipped)) {
      if (!gear) continue;
      // Alpha policy: missing content blows up loudly rather than silently
      // equipping a no-op item.
      const def = getItem(gear.itemId);
      const baseline = def.modifiers ?? [];
      const rolled = gear.rolledMods ?? [];
      if (baseline.length === 0 && rolled.length === 0) continue;
      const source = `equip:${slot}:${gear.instanceId}`;
      addModifiers(
        c.attrs,
        [...baseline, ...rolled].map((m) => ({ ...m, sourceId: source })),
      );
    }
  }

  // 2.5) World upgrade modifiers (players only).
  //      Injected after gear so the stacking order is: base → gear → world.
  //      source prefix "world." lets callers removeModifiersBySource("world.")
  //      for targeted revocation if ever needed.
  if (worldRecord && c.kind === "player") {
    const worldMods = computeWorldModifiers(worldRecord, getContent());
    if (worldMods.length > 0) addModifiers(c.attrs, worldMods);
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
  const maxHp = getAttrFromSet(c.attrs, ATTR.MAX_HP, attrDefs);
  const maxMp = getAttrFromSet(c.attrs, ATTR.MAX_MP, attrDefs);
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

// NOTE: safeGetItem was removed — equipped now carries a GearInstance whose
// itemId must resolve. Alpha policy: throw loudly (via getItem) rather than
// silently treating missing content as "no modifiers".

function safeGetEffect(id: string) {
  try {
    return getEffect(id);
  } catch {
    return undefined;
  }
}

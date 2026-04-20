// Static content definitions.
//
// All content is keyed by dot-namespaced string IDs:
//   "ability.combat.fire.fireball"
//   "item.ore.copper"
//   "skill.mining"
//
// Definitions are plain data. They may reference other content by ID (never
// hold direct references). This keeps the save file ID-only.

import type { FormulaRef } from "../formula/types";

// ---------- Branded ID types ----------
// Brands are compile-time only; at runtime they're plain strings.

export type ItemId = string & { readonly __brand: "ItemId" };
export type MonsterId = string & { readonly __brand: "MonsterId" };
export type AbilityId = string & { readonly __brand: "AbilityId" };
export type EffectId = string & { readonly __brand: "EffectId" };
export type SkillId = string & { readonly __brand: "SkillId" };
export type StageId = string & { readonly __brand: "StageId" };
export type RecipeId = string & { readonly __brand: "RecipeId" };
export type AttrId = string & { readonly __brand: "AttrId" };
export type TalentId = string & { readonly __brand: "TalentId" };

// ---------- Attribute ----------

export interface AttrDef {
  id: AttrId;
  /** Human-readable label for UI. */
  name: string;
  /** Default base value for freshly-created units. */
  defaultBase: number;
  /** Optional clamp applied AFTER modifier resolution. */
  clampMin?: number;
  clampMax?: number;
  /** If true, value stays integer (floor after clamp). */
  integer?: boolean;
}

// ---------- Modifier ----------

export type ModifierOp = "flat" | "pct_add" | "pct_mult";

export interface Modifier {
  stat: AttrId;
  op: ModifierOp;
  value: number;
  sourceId: string;           // where this modifier came from (item, effect, talent)
}

// ---------- Items ----------

export interface ItemDef {
  id: ItemId;
  name: string;
  stackable: boolean;
  /** Equip slot if this is gear (e.g. "weapon", "helmet"). */
  slot?: string;
  /** Modifiers this item grants when equipped. */
  modifiers?: Modifier[];
  tags?: string[];
}

// ---------- Monsters ----------

export interface MonsterDef {
  id: MonsterId;
  name: string;
  level: number;
  /** Base attributes for this monster (pre-modifier). */
  baseAttrs: Partial<Record<AttrId, number>>;
  /** Abilities this monster can use. First entry is the default attack. */
  abilities: AbilityId[];
  /** Loot table entries. */
  drops: { itemId: ItemId; chance: number; minQty: number; maxQty: number }[];
  /** XP rewarded on kill (to the character / party). */
  xpReward: number;
}

// ---------- Effects ----------

export type EffectKind = "instant" | "duration" | "periodic";

export interface EffectDef {
  id: EffectId;
  name?: string;
  kind: EffectKind;
  /** For duration/periodic: total lifetime in ticks. */
  durationTicks?: number;
  /** For periodic: how often (in ticks) the periodic hit fires. */
  periodTicks?: number;
  /** Modifiers applied for the lifetime of this effect. */
  modifiers?: Modifier[];
  /** Rewards granted on apply (instant) or per period (periodic). */
  rewards?: {
    items?: { itemId: ItemId; qty: number }[];
    xp?: { skillId: SkillId; amount: number }[];
    charXp?: number;
  };
  /** Formula used to compute numeric magnitude (e.g. damage). */
  formula?: FormulaRef;
  /** Whether magnitude is damage (subtract HP) or heal (add HP). */
  magnitudeMode?: "damage" | "heal";
  tags?: string[];
}

// ---------- Abilities ----------

export type TargetKind =
  | "self"
  | "single_enemy"
  | "single_ally"
  | "all_enemies"
  | "all_allies"
  | "none"; // non-combat abilities (e.g. a mining swing)

export interface AbilityDef {
  id: AbilityId;
  name: string;
  /** Resource cost. */
  cost?: { mp?: number };
  /** Cooldown in ticks. */
  cooldownTicks?: number;
  targetKind: TargetKind;
  /** Effects to apply, in order, on each target. */
  effects: EffectId[];
  tags?: string[];
}

// ---------- Skills ----------

export interface SkillDef {
  id: SkillId;
  name: string;
  /** Formula for XP required to reach the given level (inclusive). */
  xpCurve: FormulaRef;
  maxLevel?: number;
}

// ---------- Stages ----------

export type StageMode = "solo" | "party";

export interface StageDef {
  id: StageId;
  name: string;
  mode: StageMode;
  /** Monsters that spawn (rotated per battle, MVP = list). */
  monsters: MonsterId[];
  /** Which skill's XP this stage grants on kill (e.g. "skill.swordsmanship"). */
  combatSkill?: SkillId;
}

// ---------- Recipes ----------

export interface RecipeDef {
  id: RecipeId;
  name: string;
  /** Skill this recipe trains. */
  skill: SkillId;
  /** Minimum skill level required. */
  requiredLevel: number;
  /** Ticks to produce one unit. */
  durationTicks: number;
  inputs: { itemId: ItemId; qty: number }[];
  outputs: { itemId: ItemId; qty: number }[];
  /** XP gained per production. */
  xpReward: number;
}

// ---------- Talents ----------

export interface TalentDef {
  id: TalentId;
  name: string;
  /** Effects applied when this talent is unlocked. */
  effects: EffectId[];
  /** Talent prereqs (DAG edges). MVP uses flat list; graph engine comes later. */
  prereqs?: TalentId[];
  /** TP cost. */
  cost: number;
}

// ---------- ContentDb ----------

export interface ContentDb {
  items: Readonly<Record<string, ItemDef>>;
  monsters: Readonly<Record<string, MonsterDef>>;
  abilities: Readonly<Record<string, AbilityDef>>;
  effects: Readonly<Record<string, EffectDef>>;
  skills: Readonly<Record<string, SkillDef>>;
  stages: Readonly<Record<string, StageDef>>;
  recipes: Readonly<Record<string, RecipeDef>>;
  talents: Readonly<Record<string, TalentDef>>;
  attributes: Readonly<Record<string, AttrDef>>;
  /** Formulas referenced by other content (xp curves, damage, etc). */
  formulas: Readonly<Record<string, FormulaRef>>;
}

/** An empty db, mostly for tests/bootstrapping. */
export function emptyContentDb(): ContentDb {
  return {
    items: {},
    monsters: {},
    abilities: {},
    effects: {},
    skills: {},
    stages: {},
    recipes: {},
    talents: {},
    attributes: {},
    formulas: {},
  };
}

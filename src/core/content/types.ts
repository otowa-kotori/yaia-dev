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

export type ResourceNodeId = string & { readonly __brand: "ResourceNodeId" };
export type ItemId = string & { readonly __brand: "ItemId" };
export type MonsterId = string & { readonly __brand: "MonsterId" };
export type AbilityId = string & { readonly __brand: "AbilityId" };
export type EffectId = string & { readonly __brand: "EffectId" };
export type SkillId = string & { readonly __brand: "SkillId" };
export type LocationId = string & { readonly __brand: "LocationId" };
export type EncounterId = string & { readonly __brand: "EncounterId" };
export type RecipeId = string & { readonly __brand: "RecipeId" };
export type AttrId = string & { readonly __brand: "AttrId" };
export type TalentId = string & { readonly __brand: "TalentId" };
/** Currency is a plain string at runtime (e.g. "currency.gold"). Branded only
 *  for call-site clarity; safe to cast with `as CurrencyId`. */
export type CurrencyId = string & { readonly __brand: "CurrencyId" };

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
  /**
   * If present, every created GearInstance rolls one Modifier per entry
   * using [min, max] inclusive. Only meaningful for stackable=false items;
   * ignored for stackables (they have no per-copy state).
   * See core/item/factory.ts for the actual roll logic.
   *
   * MVP: every entry is always rolled. If/when we need per-affix probability
   * or rarity tiers, add `chance?: number` and `rarity?` here.
   */
  roll?: {
    mods: {
      stat: AttrId;
      op: ModifierOp;
      min: number;
      max: number;
      /** Default true — attribute affixes round to integers. */
      integer?: boolean;
    }[];
  };
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
  /** Currencies rewarded on kill. key = currency id (e.g. "currency.gold"). */
  currencyReward?: Record<string, number>;
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
    /** Currencies to add to GameState.currencies on reward. key = currency id. */
    currencies?: Record<string, number>;
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

// ---------- Encounters & Locations ----------
//
// Three-layer model:
//   LocationDef   — "where am I" (physical place / map area)
//   LocationEntry — "what can I do here" (combat / gather / npc entries)
//   EncounterDef  — "how does this fight work" (waves, rewards, thresholds)
//
// EncounterDef is a top-level ContentDb citizen so it can be looked up by
// id without knowing which Location it belongs to.

export type EncounterWaveSelection = "random";

export interface WaveRewardDropDef {
  itemId: ItemId;
  chance: number;
  minQty: number;
  maxQty: number;
}

export interface WaveRewardDef {
  /** Loot rolled once when the player clears the wave. */
  drops?: WaveRewardDropDef[];
  /** Fixed currencies granted on wave clear. */
  currencies?: Record<string, number>;
}

export interface WaveDef {
  id: string;
  name: string;
  /** Exact enemy lineup for this wave. */
  monsters: MonsterId[];
  /** Rewards granted only when the wave is cleared (not on player wipe). */
  rewards?: WaveRewardDef;
}

export interface EncounterDef {
  id: EncounterId;
  name: string;
  /** Candidate waves for this encounter. Current MVP only supports random pick. */
  waves: WaveDef[];
  /** Selection strategy hook for future encounter-specific logic. */
  waveSelection?: EncounterWaveSelection;
  /** Ticks between one wave resolving and the next wave spawning. */
  waveIntervalTicks?: number;
  /** After a battle ends, pause to heal if HP ratio is at or below this threshold.
   *  Different difficulty encounters can use different thresholds. */
  recoverBelowHpFactor?: number;
  /** Which skill's XP this encounter grants on kill (e.g. "skill.swordsmanship"). */
  combatSkill?: SkillId;
}

// ---------- Location entries ----------

export type LocationEntryDef =
  | { kind: "combat"; encounterId: EncounterId; label?: string }
  | { kind: "gather"; resourceNodes: ResourceNodeId[]; label?: string };

/** A physical location / map area. Contains a menu of available entries
 *  the player can choose from. The actual running instance (actor spawning,
 *  battle ticking) happens in StageSession / StageController after the
 *  player picks an entry. */
export interface LocationDef {
  id: LocationId;
  name: string;
  entries: LocationEntryDef[];
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

// ---------- ResourceNodes (life skill harvest sites) ----------

export interface ResourceNodeDrop {
  itemId: ItemId;
  /** Probability of this entry rolling a hit on a swing. */
  chance: number;
  minQty: number;
  maxQty: number;
}

export interface ResourceNodeDef {
  id: ResourceNodeId;
  name: string;
  /** Skill trained by gathering here. */
  skill: SkillId;
  /** Minimum skill level to interact. Default: 1 (no gate). */
  requiredLevel?: number;
  /** Ticks per swing. Fixed at MVP; future: formula based on skill / tool. */
  swingTicks: number;
  /** Loot table rolled on every successful swing. */
  drops: ResourceNodeDrop[];
  /** Skill XP granted per swing. */
  xpPerSwing: number;
}

// ---------- Upgrades (global / WorldRecord) ----------
//
// Each UpgradeDef represents a purchasable permanent upgrade that affects
// all PlayerCharacters via the WorldRecord mechanism. Level N means the
// modifierPerLevel entry is applied N times during rebuildCharacterDerived.
// Non-attribute effects (drop rate multipliers, etc.) are read directly from
// WorldRecord.upgrades[id] at the call site — they don't need modifiers.

export interface UpgradeDef {
  id: string;
  name: string;
  /** Short description shown in the upgrade shop UI. */
  description: string;
  /** Maximum purchasable level. */
  maxLevel: number;
  /** Modifiers injected once per level held. Level 3 → 3 copies stacked.
   *  sourceId on each modifier is overwritten to "world.<upgradeId>" by
   *  computeWorldModifiers — the value here is ignored. */
  modifierPerLevel: Modifier[];
  /** Currency id used to buy the next level (e.g. "currency.gold"). */
  costCurrency: string;
  /** Cost to reach nextLevel = base * growth^(nextLevel-1).
   *  Reuses FormulaRef/exp_curve_v1 so the same evalFormula path applies. */
  costScaling: FormulaRef;
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

// ---------- New game bootstrap ----------
//
// Configures how a brand-new save is populated: the starting PlayerCharacter
// and which location the player lands in. Lives in ContentDb so designers (not
// code) own the decision. Optional for tests / fixture DBs; resetToFresh
// throws loudly if a session tries to boot without it.

export interface StartingConfig {
  hero: {
    id: string;
    name: string;
    xpCurve: FormulaRef;
    knownAbilities: AbilityId[];
    /** Per-character bag capacity. Falls back to DEFAULT_CHAR_INVENTORY_CAPACITY. */
    inventoryCapacity?: number;
  };
  initialLocationId: LocationId;
}

// ---------- ContentDb ----------

export interface ContentDb {
  items: Readonly<Record<string, ItemDef>>;
  monsters: Readonly<Record<string, MonsterDef>>;
  abilities: Readonly<Record<string, AbilityDef>>;
  effects: Readonly<Record<string, EffectDef>>;
  skills: Readonly<Record<string, SkillDef>>;
  locations: Readonly<Record<string, LocationDef>>;
  encounters: Readonly<Record<string, EncounterDef>>;
  recipes: Readonly<Record<string, RecipeDef>>;
  talents: Readonly<Record<string, TalentDef>>;
  upgrades: Readonly<Record<string, UpgradeDef>>;
  attributes: Readonly<Record<string, AttrDef>>;
  resourceNodes: Readonly<Record<string, ResourceNodeDef>>;
  /** Formulas referenced by other content (xp curves, damage, etc). */
  formulas: Readonly<Record<string, FormulaRef>>;
  /** New-game bootstrap config. Optional so empty/test DBs still type-check;
   *  session.resetToFresh throws if a real game tries to boot without it. */
  starting?: StartingConfig;
}

/** An empty db, mostly for tests/bootstrapping. */
export function emptyContentDb(): ContentDb {
  return {
    items: {},
    monsters: {},
    abilities: {},
    effects: {},
    skills: {},
    locations: {},
    encounters: {},
    recipes: {},
    talents: {},
    upgrades: {},
    attributes: {},
    resourceNodes: {},
    formulas: {},
  };
}

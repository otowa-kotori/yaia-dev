// Static content definitions.
//
// All content is keyed by dot-namespaced string IDs:
//   "talent.knight.power_strike"
//   "item.ore.copper"
//   "skill.mining"
//
// Most definitions are plain data. TalentDef and EffectDef may hold functions
// (execute, grantEffects, reactions) — they live in ContentDb but are NOT
// serialized. See docs/design/skill-system.md §2.4.

import type { FormulaRef } from "../infra/formula/types";
import type { ReactionHooks } from "../combat/reaction/types";
import type { PriorityRule, TargetPolicy } from "../combat/intent/priority";
import type { GameEventBus } from "../infra/events";
import type { Rng } from "../infra/rng";
import type { GameState } from "../infra/state/types";
import type { Character, PlayerCharacter } from "../entity/actor/types";


// ---------- Branded ID types ----------
// Brands are compile-time only; at runtime they're plain strings.

export type ResourceNodeId = string & { readonly __brand: "ResourceNodeId" };
export type ItemId = string & { readonly __brand: "ItemId" };
export type MonsterId = string & { readonly __brand: "MonsterId" };
export type EffectId = string & { readonly __brand: "EffectId" };
export type SkillId = string & { readonly __brand: "SkillId" };
export type LocationId = string & { readonly __brand: "LocationId" };
export type CombatZoneId = string & { readonly __brand: "CombatZoneId" };
export type DungeonId = string & { readonly __brand: "DungeonId" };
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

  // ---- Reactive / derived fields (optional) ----

  /**
   * Derived base computation function. When provided, recomputeStat uses its
   * return value instead of set.base[id]. The `get` callback reads another
   * attribute's final value, recursively triggering lazy recompute if needed.
   *
   * Example — PATK = weaponAtk × (1 + 0.3 × √STR):
   *   computeBase: (get) => get(ATTR.WEAPON_ATK) * (1 + 0.3 * Math.sqrt(get(ATTR.STR)))
   */
  computeBase?: (get: (attrId: AttrId) => number) => number;

  /**
   * Which attributes computeBase reads. Used to build the depGraph so that
   * when a dependency changes, this stat's cache is automatically invalidated.
   * Only meaningful when computeBase is set.
   */
  dependsOn?: AttrId[];
}

// ---------- Modifier ----------

export type ModifierOp = "flat" | "pct_add" | "pct_mult";

export interface Modifier {
  stat: AttrId;
  op: ModifierOp;
  value: number;
  sourceId: string;           // where this modifier came from (item, effect, talent)
}

// ---------- Dynamic Modifier Provider ----------

/**
 * A dynamic modifier provider computes modifier values at query time,
 * based on the current value of other attributes (via `get`).
 *
 * Install with `addDynamicProvider`; remove with `removeDynamicProvider`.
 * Not persisted — rebuilt from activeEffects / talents on load.
 *
 * Example — heal power scales with INT:
 *   compute: (get) => [{ stat: ATTR.HEAL_POWER, op: "flat",
 *                         value: get(ATTR.INT) * 0.002, sourceId }]
 */
export interface DynamicModifierProvider {
  /** Unique identifier for install/uninstall. E.g. "talent:guardian_prayer:3". */
  sourceId: string;
  /** Which attributes this provider's output modifiers can affect.
   *  Must cover all stats that compute() may return — used for invalidation. */
  targetAttrs: AttrId[];
  /** Which attributes compute() reads via get(). Used to propagate invalidation. */
  dependsOn: AttrId[];
  /** Called during recomputeStat for each targetAttr. get() reads other attrs' final values. */
  compute: (get: (id: AttrId) => number) => Modifier[];
}

// ---------- Items ----------

export interface ItemDef {
  id: ItemId;
  name: string;
  description?: string;
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
  /** Talents this monster can use. First entry is the default attack. */
  talents: TalentId[];
  /** Loot table entries. */
  drops: { itemId: ItemId; chance: number; minQty: number; maxQty: number }[];
  /** XP rewarded on kill (to the character / party). */
  xpReward: number;
  /** Currencies rewarded on kill. key = currency id (e.g. "currency.gold"). */
  currencyReward?: Record<string, number>;
  /** Which primary attributes contribute to PHYS_POTENCY (→ PATK).
   *  Installed as DynamicModifierProviders in rebuildCharacterDerived.
   *  Default: [{attr: ATTR.STR, ratio: 1.0}]. */
  physScaling?: { attr: AttrId; ratio: number }[];
  /** Which primary attributes contribute to MAG_POTENCY (→ MATK).
   *  Default: [{attr: ATTR.INT, ratio: 1.0}]. */
  magScaling?: { attr: AttrId; ratio: number }[];
  /** Priority-list AI rules for combat. If omitted, uses basic attack on
   *  a random enemy. */
  intentConfig?: PriorityRule[];
}

// ---------- Effects ----------

export type EffectKind = "instant" | "duration" | "periodic";

/** Minimal context for effect lifecycle hooks. Full type in behavior/effect. */
export type EffectLifecycleCtx = Record<string, unknown>;

export interface EffectDef {
  id: EffectId;
  name?: string;
  kind: EffectKind;
  /** For duration/periodic: total lifetime in owner action counts. */
  durationActions?: number;
  /** For periodic: fire every N owner actions. */
  periodActions?: number;
  /** Static modifiers applied for the lifetime of this effect. Ignored when
   *  computeModifiers is provided. */
  modifiers?: Modifier[];
  /** Dynamic modifier computation. When present, called at install time with
   *  the EffectInstance's state to produce the modifier list. Replaces static
   *  `modifiers`. Use for level-scaled passives, stance buffs, etc. */
  computeModifiers?: (state: Record<string, unknown>) => Modifier[];
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

  /** Reaction dispatch priority. Lower = earlier. Default 0. */
  reactionPriority?: number;
  /** How multiple applications of the same effect interact. */
  stackMode?: "separate" | "refresh" | "stackable";
  /** Max stacks for stackable mode. */
  maxStacks?: number;
  /** Called when the effect is first applied. Can snapshot data into state. */
  onApply?: (source: Character, target: Character, state: Record<string, unknown>, ctx: EffectLifecycleCtx) => void;
  /** Called each owner action for periodic effects. */
  onTick?: (owner: Character, state: Record<string, unknown>, ctx: EffectLifecycleCtx) => void;
  /** Called when the effect is removed. */
  onRemove?: (owner: Character, state: Record<string, unknown>, ctx: EffectLifecycleCtx) => void;
  /** Combat reaction hooks. Dispatched while effect is active. */
  reactions?: ReactionHooks;
}

// ---------- Talents ----------
//
// TalentDef replaces the old AbilityDef. It unifies active skills (execute),
// passive buffs (grantEffects), and sustain stances under one type.
// TalentDef may hold functions — it lives in ContentDb but is NOT serialized.
// See docs/design/skill-system.md for the full design.

export type TargetKind =
  | "self"
  | "single_enemy"
  | "single_ally"
  | "all_enemies"
  | "all_allies"
  | "none";

/**
 * Describes one effect application from grantEffects.
 * effectId identifies the template; state carries instance-specific data.
 */
export interface EffectApplication {
  effectId: EffectId;
  state: Record<string, unknown>;
}

/**
 * Static talent context used by authoring hooks that only need deterministic
 * read-only information, such as UI preview and scaling calculation.
 */
export interface TalentStaticContext {
  /** Talent level being described / queried. */
  level: number;
  /** Owning player character when available; null in non-player preview paths. */
  owner: PlayerCharacter | null;
}

/**
 * Runtime talent context used by execute().
 *
 * It extends the static context with concrete battle state and mutation
 * helpers, so authoring code can clearly distinguish preview-only hooks from
 * actual execution.
 */
export interface TalentExecutionContext extends TalentStaticContext {
  caster: Character;
  targets: Character[];
  participants: readonly Character[];
  state: GameState;
  bus: GameEventBus;
  rng: Rng;
  currentTick: number;
  dealPhysicalDamage(target: Character, coefficient: number): number;
  dealMagicDamage(target: Character, coefficient: number): number;
  applyEffect(effectId: EffectId, target: Character, state: Record<string, unknown>): void;
  aliveEnemies(): Character[];
  aliveAllies(): Character[];
}

export type TalentActiveParams = {
  targetKind: TargetKind;
} & Partial<{
  /** Default 0. */
  mpCost: number;
  /** Cooldown in owner action counts. Default 0. */
  cooldownActions: number;
  /** Relative to the scheduler's standard action cost. 1 = default action. */
  actionCostRatio: number;
  /** Optional upper bound for selected targets. */
  maxTargets: number;
}>;


export interface TalentDef {

  id: TalentId;
  name: string;
  description?: string;
  type: "active" | "passive" | "sustain";
  /** Maximum learnable level. */
  maxLevel: number;
  /** TP cost per level. */
  tpCost: number;
  /** Prerequisite talents required to learn this one. */
  prereqs?: { talentId: TalentId; minLevel: number }[];
  tags?: string[];
  /**
   * Returns a human-readable description of what this talent does at the given
   * context. Shown in the talent allocation UI so the player can see what each
   * level provides. Level 0 describes the talent before any points are spent
   * (i.e. "next level preview"). Omit for talents whose description field
   * suffices (e.g. basic attack with no scaling).
   */
  describe?: (ctx: TalentStaticContext) => string;



  // ---- intent AI fields ----

  /** Default priority when auto-building intent rules from equipped talents.
   *  Lower = higher priority (tried first). Omit to fall after all talents
   *  that have an explicit priority. */
  intentPriority?: number;
  /** Override target selection policy for intent AI. If omitted, inferred
   *  from getActiveParams().targetKind:
   *    self → "self", single_enemy → "random_enemy",
   *    all_enemies → "all_enemies", single_ally → "lowest_hp_ally",
   *    all_allies → (all allies). */
  intentTargetPolicy?: TargetPolicy;

  // ---- effect parameter getter ----

  /**
   * Compute concrete effect values for a given talent context. Single source of
   * truth: grantEffects passes these into EffectInstance.state, describe()
   * reads them for UI text, and execute() uses them for runtime logic.
   * Eliminates the need to duplicate scaling formulas in both talent and
   * effect definitions.
   */
  getEffectParams?: (ctx: TalentStaticContext) => Record<string, number>;

  // ---- active skill fields ----

  /** Returns active-skill parameters for the given context.
   *  Omit for non-active talents. Most fields are optional defaults:
   *  mpCost = 0, cooldownActions = 0, actionCostRatio = 1. */
  getActiveParams?: (ctx: TalentStaticContext) => TalentActiveParams;

  /**
   * Active skill execution logic. The generic pipeline completes validation +
   * resource deduction, then calls this. This IS the action — freely
   * orchestrate multi-hit, conditional branching, effect application inside.
   */
  execute?: (ctx: TalentExecutionContext) => void;



  /**
   * Declarative shortcut: if no execute is provided, the pipeline applies
   * these effects in order on each target (same semantics as old AbilityDef.effects).
   * If both execute and effects are provided, execute takes priority.
   */
  effects?: EffectId[];

  // ---- passive / sustain fields ----

  /**
   * Effects installed when the talent is learned (passive) or activated (sustain).
   * Returns effect descriptions with initial state.
   */
  grantEffects?: (level: number, owner: Character) => EffectApplication[];

  // ---- sustain-only fields ----

  /** Activation cost for sustain talents. */
  activationCost?: { mp?: number };
  /** Mutual exclusion group. Only one sustain per group per character. */
  exclusiveGroup?: string;
}

// ---------- Skills ----------

export interface SkillDef {
  id: SkillId;
  name: string;
  /** Formula for XP required to reach the given level (inclusive). */
  xpCurve: FormulaRef;
  maxLevel?: number;
}

// ---------- CombatZones & Locations ----------
//
// Three-layer model:
//   LocationDef   — "where am I" (physical place / map area)
//   LocationEntry — "what can I do here" (combat / gather / npc entries)
//   CombatZoneDef  — "how does this fight work" (waves, rewards,队伍限制)
//
// CombatZoneDef is a top-level ContentDb citizen so it can be looked up by
// id without knowing which Location it belongs to.


export type CombatZoneWaveSelection = "random";

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
  /** Exact enemy lineup for this wave. */
  monsters: MonsterId[];
  /** Rewards granted only when the wave is cleared (not on player wipe). */
  rewards?: WaveRewardDef;
}


export interface CombatZoneDef {
  id: CombatZoneId;
  name: string;
  /** Candidate waves for this combat zone. Current MVP only supports random pick. */
  waves: WaveDef[];
  /** Selection strategy hook for future zone-specific logic. */
  waveSelection?: CombatZoneWaveSelection;
  /** Minimum party size required to enter this combat zone. */
  minPartySize?: number;
  /** Maximum party size allowed in this combat zone. */
  maxPartySize?: number;
  /** Which skill's XP this combat zone grants on kill (e.g. "skill.swordsmanship"). */
  combatSkill?: SkillId;
}



// ---------- Dungeons ----------
//
// A dungeon is a linear sequence of fixed waves. Unlike CombatZone (infinite
// random loop), a dungeon has an end: clear the last wave to complete it.
// Multiple characters enter as a party and share one Stage + Battle.

export interface DungeonWaveDef {
  id: string;
  name: string;
  /** Exact enemy lineup for this wave. */
  monsters: MonsterId[];
  /** Rewards granted when this wave is cleared. */
  rewards?: WaveRewardDef;
}

export interface DungeonDef {
  id: DungeonId;
  name: string;
  /** Fixed-order wave sequence. Players fight wave[0], then wave[1], etc. */
  waves: DungeonWaveDef[];
  /** Bonus rewards granted on full dungeon completion. */
  completionRewards?: WaveRewardDef;
  /** Minimum party size required to enter. */
  minPartySize?: number;
  /** Maximum party size allowed. */
  maxPartySize?: number;
}

// ---------- Location entries ----------

export type LocationEntryDef =
  | { kind: "combat"; combatZoneId: CombatZoneId; label?: string }
  | { kind: "gather"; resourceNodes: ResourceNodeId[]; label?: string }
  | { kind: "dungeon"; dungeonId: DungeonId; label?: string };

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

// ---------- New game bootstrap ----------
//
// Configures how a brand-new save is populated: the starting PlayerCharacters
// and which location each hero lands in. Lives in ContentDb so designers (not
// code) own the decision. Optional for tests / fixture DBs; resetToFresh
// throws loudly if a session tries to boot without it.

export interface HeroConfig {
  id: string;
  name: string;
  xpCurve: FormulaRef;
  /** Talents the hero starts with (source of truth for runtime talent list). */
  knownTalents: TalentId[];
  /** Talents this hero class can learn via talent point allocation. */
  availableTalents?: TalentId[];
  /** Per-character bag capacity. Falls back to DEFAULT_CHAR_INVENTORY_CAPACITY. */
  inventoryCapacity?: number;
  /** Items granted into the hero's personal bag on a brand-new save. */
  startingItems?: { itemId: ItemId; qty: number }[];
  /** Override per-attribute base values (applied over AttrDef.defaultBase). */
  baseAttrs?: Partial<Record<AttrId, number>>;
  /** Per-level attribute increment. Applied to attrs.base on every level-up.
   *  Small fractions are fine — integer: true AttrDefs floor the final value. */
  growth?: Partial<Record<AttrId, number>>;
  /** Which primary attributes contribute to PHYS_POTENCY (→ PATK).
   *  Installed as DynamicModifierProviders in rebuildCharacterDerived. */
  physScaling?: { attr: AttrId; ratio: number }[];
  /** Which primary attributes contribute to MAG_POTENCY (→ MATK). */
  magScaling?: { attr: AttrId; ratio: number }[];
}

export interface StartingConfig {
  heroes: HeroConfig[];
  initialLocationId: LocationId;
}

// ---------- ContentDb ----------

export interface ContentDb {
  items: Readonly<Record<string, ItemDef>>;
  monsters: Readonly<Record<string, MonsterDef>>;
  effects: Readonly<Record<string, EffectDef>>;
  skills: Readonly<Record<string, SkillDef>>;
  locations: Readonly<Record<string, LocationDef>>;
  combatZones: Readonly<Record<string, CombatZoneDef>>;
  dungeons: Readonly<Record<string, DungeonDef>>;
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
    effects: {},
    skills: {},
    locations: {},
    combatZones: {},
    dungeons: {},
    recipes: {},
    talents: {},
    upgrades: {},
    attributes: {},
    resourceNodes: {},
    formulas: {},
  };
}

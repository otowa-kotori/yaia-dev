// Actor hierarchy.
//
// UE-inspired, but implemented with TypeScript interface inheritance (not
// class inheritance) because state must round-trip through JSON — methods
// and prototypes are lost by serialization.
//
//   Actor                      (any world entity; has id + kind)
//     ├── Character             (a living thing with HP/MP/Attrs/Effects)
//     │     ├── PlayerCharacter  (level/exp/skills/equipped/talents/activity/…)
//     │     └── Enemy            (defId → MonsterDef)
//     └── ResourceNode          (mine / tree / fishing spot — gatherable)
//
// Actors live directly in GameState.actors and are mutated in place. Derived
// state (attribute modifier stack, attrs cache, runtime ability list) is
// stored on the Actor too, but the save serializer deliberately omits it —
// see src/core/save/serialize.ts for the explicit field whitelist. Derived
// fields are rebuilt on load via rebuildCharacterDerived.
//
// Discriminant: use `actor.kind`. Runtime checks:
//   isCharacter(a) — has HP/MP/Attrs (player or enemy)
//   isPlayer(a)    — kind === "player"
//   isEnemy(a)     — kind === "enemy"
//   isResourceNode(a) — kind === "resource_node"

import type { AbilityId, MonsterId } from "../content/types";
import type { AttrSet } from "../attribute";
import type {
  ActiveEffect,
  CharacterActivityState,
  SkillProgress,
} from "../state/types";
import type { SkillId } from "../content/types";
import type { FormulaRef } from "../formula/types";

/** Team / side within a battle. Transient — not persisted. */
export type Side = "player" | "enemy" | "neutral";

// Kind discriminants. Keep open for future actor kinds (npc, crop, …).
export type ActorKind = "player" | "enemy" | "resource_node";

// ---------- Actor (root) ----------

/** Any world entity tracked by the game. */
export interface Actor {
  id: string;
  name: string;
  kind: ActorKind;
}

// ---------- Character (living thing) ----------

/** A living actor with stats, HP/MP, active effects, cooldowns. */
export interface Character extends Actor {
  /** HP/MP (persisted, clamp on load). */
  currentHp: number;
  currentMp: number;
  /** Active buffs/debuffs/DoTs. (persisted) */
  activeEffects: ActiveEffect[];
  /** Absolute-tick cooldown map: abilityId -> tick at which ready. (persisted) */
  cooldowns: Record<string, number>;
  /** Attribute set.
   *  - `attrs.base` is persisted (source of truth for per-actor base stats).
   *  - `attrs.modifiers` and `attrs.cache` are DERIVED — not persisted.
   */
  attrs: AttrSet;
  /** Runtime ability list. Derived for PlayerCharacter; part of def for Enemy.
   *  Not persisted — rebuilt on load from known abilities + equipped gear. */
  abilities: AbilityId[];
  /** Optional transient side for combat targeting. Not persisted. */
  side?: Side;
}

// ---------- PlayerCharacter ----------

export interface PlayerCharacter extends Character {
  kind: "player";
  level: number;
  exp: number;
  /** Formula giving XP required to reach a given level for this character.
   *  Per-character so class / special growths can vary. */
  xpCurve: FormulaRef;
  /** Hard level cap for this character. */
  maxLevel: number;
  skills: Record<SkillId, SkillProgress>;
  /** Slot -> itemId or null. (persisted) */
  equipped: Record<string, string | null>;
  /** Unlocked talent ids. (persisted) */
  talents: string[];
  /** What this character is currently doing. null = idle. (persisted) */
  activity: CharacterActivityState | null;
  /** Ability ids the player has learned (source of truth for `abilities`). */
  knownAbilities: AbilityId[];
}

// ---------- Enemy ----------

export interface Enemy extends Character {
  kind: "enemy";
  /** Content ID of the MonsterDef this enemy was spawned from. */
  defId: MonsterId;
}

// ---------- ResourceNode ----------
//
// A gatherable world entity (ore vein, tree, fishing spot). NOT a Character
// because it has no HP / MP / attrs / abilities; interacting with it goes
// through GatherActivity rather than combat.
//
// "Infinite yield" at MVP — no depletion. If/when yield matters, add
// `currentYield: number` and let GatherActivity decrement it.

export interface ResourceNode extends Actor {
  kind: "resource_node";
  /** Content ID of the ResourceNodeDef this node was spawned from. */
  defId: string;
}

// ---------- Type guards ----------

export function isCharacter(a: Actor): a is Character {
  return a.kind === "player" || a.kind === "enemy";
}

export function isPlayer(a: Actor): a is PlayerCharacter {
  return a.kind === "player";
}

export function isEnemy(a: Actor): a is Enemy {
  return a.kind === "enemy";
}

export function isResourceNode(a: Actor): a is ResourceNode {
  return a.kind === "resource_node";
}

export function isAlive(c: Character): boolean {
  return c.currentHp > 0;
}

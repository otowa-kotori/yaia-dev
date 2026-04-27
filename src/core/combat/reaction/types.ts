// Reaction system types.
//
// Reactions are synchronous, mutable hooks that fire DURING combat resolution
// (inside the damage pipeline, after kills, etc). They are fundamentally
// different from GameEventBus events:
//   - Reactions can MODIFY combat data (e.g. before_damage_taken reduces damage)
//   - GameEventBus events are READ-ONLY after-the-fact notifications
//
// Reactions live on EffectDef.reactions and are dispatched to all active
// EffectInstances on the target character. See dispatch.ts for the engine.
//
// Two dispatch modes:
//   targeted  — only dispatch to effects on the event's subject
//   broadcast — dispatch to all alive actors on a side (or all)

import type { Character } from "../../entity/actor/types";
import type { EffectId } from "../../content/types";
import type { GameEventBus } from "../../infra/events";
import type { Rng } from "../../infra/rng";
import type { GameState } from "../../infra/state/types";
import type { Battle } from "../battle/battle";

// ---------- DamageType ----------

export type DamageType = "physical" | "magical";

// ---------- ReactionEvent ----------

/**
 * Discriminated union of all reaction events. Each variant documents its
 * dispatch mode (targeted vs broadcast).
 */
export type ReactionEvent =
  // ---- targeted: dispatch to effects on the subject ----
  | {
      kind: "before_damage_taken";
      attacker: Character;
      rawDamage: number;
      damageType: DamageType;
      /** Mutable — reactions can reduce finalDamage. */
      result: { finalDamage: number };
    }
  | {
      kind: "after_damage_taken";
      attacker: Character;
      damage: number;
      damageType: DamageType;
    }
  | {
      kind: "after_damage_dealt";
      target: Character;
      damage: number;
      damageType: DamageType;
      talentId?: string;
    }
  | { kind: "on_kill"; victim: Character }
  | { kind: "on_heal_dealt"; target: Character; amount: number }
  | {
      kind: "on_action_resolved";
      talentId: string;
      targets: Character[];
    }
  // ---- broadcast: dispatch to all allies / all participants ----
  | {
      kind: "on_ally_damaged";
      ally: Character;
      attacker: Character;
      damage: number;
    }
  | { kind: "battle_start" }
  | { kind: "battle_end" }
  | { kind: "wave_end" };

// ---------- ReactionHooks ----------

/** Handler function for a specific reaction event kind. */
export type ReactionHandler<K extends ReactionEvent["kind"]> = (
  owner: Character,
  event: Extract<ReactionEvent, { kind: K }>,
  state: Record<string, unknown>,
  ctx: ReactionContext,
) => void;

/**
 * Map of event kind → handler. Each EffectDef can provide handlers for any
 * subset of event kinds. TypeScript automatically narrows the event parameter.
 */
export type ReactionHooks = {
  [K in ReactionEvent["kind"]]?: ReactionHandler<K>;
};

// ---------- ReactionContext ----------

/**
 * Toolkit passed to reaction handlers. Provides a controlled API for
 * side effects (dealing damage, healing, applying effects) so that
 * reaction handlers don't need raw access to the combat pipeline.
 */
export interface ReactionContext {
  /** Deal physical damage using the standard combat formula + reaction pipeline. */
  dealPhysicalDamage(source: Character, target: Character, coefficient: number): number;
  /** Deal magical damage using the standard combat formula + reaction pipeline. */
  dealMagicDamage(source: Character, target: Character, coefficient: number): number;
  /** Deal flat damage to a target. Bypasses formulas; use for redirected/already-resolved damage. */
  dealDamage(source: Character, target: Character, amount: number, damageType?: DamageType): void;
  /** Heal a target. */
  healTarget(target: Character, amount: number): void;
  /** Apply an effect from source onto target with initial state. */
  applyEffect(
    effectId: EffectId,
    source: Character,
    target: Character,
    state: Record<string, unknown>,
  ): void;
  /** Request removal of the calling effect (identified by state reference). */
  removeEffect(owner: Character, state: Record<string, unknown>): void;

  // ---- reentry / depth tracking (managed by dispatch engine) ----
  activeReactionKeys: Set<string>;
  reactionDepth: number;

  // ---- pass-through context ----
  rng: Rng;
  bus: GameEventBus;
  state: GameState;
  battle: Battle;
  participants: readonly Character[];
}

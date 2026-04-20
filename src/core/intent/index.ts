// Intent: the auto-behavior decision layer.
//
// An Intent answers "given the current battle state, what should this actor
// do this turn?" It is a pure function — NO mutation, NO async. Combat code
// calls the actor's intent, gets a plan, then dispatches through
// tryUseAbility which does all the validation and state changes.
//
// Intents are small and easy to compose. At MVP we ship RandomAttackIntent
// and expose the Intent type so content can register more. A future
// PriorityListIntent can read a rules table from content data without
// changing Battle or tryUseAbility.
//
// Registry model (added for save-file support):
//   - Intents are functions. Functions can't be JSON-serialized, so Battle
//     can't store them directly if we want battles to live in GameState.
//   - Resolution is via a module-level registry keyed by string ID. Battle
//     stores `intents: Record<actorId, intentId>`; at action time, the
//     dispatcher looks up the function by id.
//   - Registration happens once at boot (see `registerBuiltinIntents`).
//     Fallback on unknown id throws — alpha-stage loudness.
//   - A PlayerCharacter with a custom AI could store its own intent id on
//     the actor (future: `actor.intent: string`). For MVP we install the
//     same intent id on every participant and done.

import type { Character } from "../actor";
import { isAlive } from "../actor";
import type { Rng } from "../rng";

export interface IntentContext {
  /** All participants in the current battle. */
  participants: readonly Character[];
  /** Shared combat RNG (used for pick()-style decisions). */
  rng: Rng;
}

/**
 * The plan returned by an Intent for a single action. A null result means
 * "skip turn / no valid action"; combat will treat it as a pass.
 */
export interface IntentAction {
  abilityId: string;
  targets: Character[];
}

export type Intent = (actor: Character, ctx: IntentContext) => IntentAction | null;

// ---------- Canonical intent IDs ----------

export const INTENT = {
  /** RandomAttackIntent — default auto-attack. */
  RANDOM_ATTACK: "intent.random_attack",
} as const;

// ---------- Registry ----------
//
// Module-level map of id -> Intent function. Populated by
// `registerBuiltinIntents()` on boot. Third-party or content-defined intents
// can `registerIntent(id, fn)` to add more.
//
// Kept private; callers resolve via `resolveIntent(id)` which throws on
// unknown ids (alpha-stage: fail loudly).

const INTENT_REGISTRY = new Map<string, Intent>();

export function registerIntent(id: string, fn: Intent): void {
  INTENT_REGISTRY.set(id, fn);
}

export function resolveIntent(id: string): Intent {
  const fn = INTENT_REGISTRY.get(id);
  if (!fn) throw new Error(`intent: unknown id "${id}"`);
  return fn;
}

/** Returns true if an intent with this id is registered. */
export function hasIntent(id: string): boolean {
  return INTENT_REGISTRY.has(id);
}

/** Test / dev hook. Clears the registry. */
export function resetIntents(): void {
  INTENT_REGISTRY.clear();
}

// ---------- Helpers ----------

/** Participants on the opposing side of `actor`. `side` is set by combat setup;
 *  if both sides are missing the helper returns an empty list rather than
 *  inventing relationships. */
export function enemiesOf(
  actor: Character,
  participants: readonly Character[],
): Character[] {
  if (!actor.side) return [];
  return participants.filter(
    (p) => p.side !== undefined && p.side !== actor.side && isAlive(p),
  );
}

export function alliesOf(
  actor: Character,
  participants: readonly Character[],
): Character[] {
  if (!actor.side) return [];
  return participants.filter(
    (p) => p.side === actor.side && p !== actor && isAlive(p),
  );
}

// ---------- RandomAttackIntent ----------
//
// MVP default: pick a random alive enemy, use the actor's first known ability
// (conventionally a single_enemy basic attack). Returns null if there are no
// valid targets or the actor has no abilities.

export const RandomAttackIntent: Intent = (actor, ctx) => {
  if (actor.abilities.length === 0) return null;
  const abilityId = actor.abilities[0]!;
  const enemies = enemiesOf(actor, ctx.participants);
  if (enemies.length === 0) return null;
  const target = ctx.rng.pick(enemies);
  return { abilityId, targets: [target] };
};

// ---------- Boot ----------

/** Install the built-in intents. Call once from game boot. Safe to call more
 *  than once (idempotent overwrite). */
export function registerBuiltinIntents(): void {
  registerIntent(INTENT.RANDOM_ATTACK, RandomAttackIntent);
}

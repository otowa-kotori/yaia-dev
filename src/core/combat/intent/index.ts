// Intent: the auto-behavior decision layer.
//
// An Intent answers "given the current battle state, what should this actor
// do this turn?" It is a pure function — NO mutation, NO async. Combat code
// calls the actor's intent, gets a plan, then dispatches through
// tryUseTalent which does all the validation and state changes.
//
// Intents are small and easy to compose. Built-in intents:
//   - RANDOM_ATTACK: pick a random enemy, use first known talent.
//   - PRIORITY_LIST: content-driven rule-based AI. Dynamically reads
//     intentConfig from HeroConfig / MonsterDef at action time, so it
//     survives save/load without per-actor registration.
//
// Registry model (for save-file support):
//   - Intents are functions. Functions can't be JSON-serialized, so Battle
//     can't store them directly if we want battles to live in GameState.
//   - Resolution is via a module-level registry keyed by string ID. Battle
//     stores `intents: Record<actorId, intentId>`; at action time, the
//     dispatcher looks up the function by id.
//   - Registration happens once at boot (see `registerBuiltinIntents`).
//     All built-in intents use stable IDs that survive serialization.
//     Fallback on unknown id throws — alpha-stage loudness.

import type { Character } from "../../entity/actor";
import { isAlive } from "../../entity/actor";
import type { Rng } from "../../infra/rng";
import type { AttrDef } from "../../content/types";

export interface IntentContext {
  /** All participants in the current battle. */
  participants: readonly Character[];
  /** Shared combat RNG (used for pick()-style decisions). */
  rng: Rng;
  /** Attribute definitions — needed for AGGRO_WEIGHT weighted targeting. */
  attrDefs?: Readonly<Record<string, AttrDef>>;
}

/**
 * The plan returned by an Intent for a single action. A null result means
 * "skip turn / no valid action"; combat will treat it as a pass.
 */
export interface IntentAction {
  talentId: string;
  targets: Character[];
}

export type Intent = (actor: Character, ctx: IntentContext) => IntentAction | null;

// ---------- Canonical intent IDs ----------

export const INTENT = {
  /** RandomAttackIntent — default auto-attack. */
  RANDOM_ATTACK: "intent.random_attack",
  /** PriorityListIntent — content-driven rule-based AI. Dynamically reads
   *  intentConfig from HeroConfig / MonsterDef at action time. */
  PRIORITY_LIST: "intent.priority_list",
} as const;

// Re-export PriorityList types and factory.
export {
  createPriorityListIntent,
  type PriorityRule,
  type TargetPolicy,
  type UseCondition,
} from "./priority";

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
// MVP default: pick a random alive enemy weighted by AGGRO_WEIGHT, use the
// actor's first known talent (conventionally a single_enemy basic attack).
// Returns null if there are no valid targets or the actor has no talents.

export const RandomAttackIntent: Intent = (actor, ctx) => {
  if (actor.knownTalentIds.length === 0) return null;
  const talentId = actor.knownTalentIds[0]!;
  const enemies = enemiesOf(actor, ctx.participants);
  if (enemies.length === 0) return null;
  const target = pickWeightedTarget(enemies, ctx);
  return { talentId, targets: [target] };
};

// ---------- Boot ----------

/** Install the built-in intents. Call once from game boot. Safe to call more
 *  than once (idempotent overwrite). */
export function registerBuiltinIntents(): void {
  registerIntent(INTENT.RANDOM_ATTACK, RandomAttackIntent);
  registerIntent(INTENT.PRIORITY_LIST, PriorityListIntent);
}

// ---------- Weighted target selection ----------

import { ATTR, getAttr as getAttrFromSet } from "../../entity/attribute";

/**
 * Pick a target from `candidates` weighted by AGGRO_WEIGHT. Falls back to
 * uniform random if attrDefs is not provided or all weights are equal.
 */
export function pickWeightedTarget(
  candidates: Character[],
  ctx: IntentContext,
): Character {
  if (candidates.length === 1) return candidates[0]!;
  if (!ctx.attrDefs) return ctx.rng.pick(candidates);

  const weights = candidates.map(c => {
    const w = getAttrFromSet(c.attrs, ATTR.AGGRO_WEIGHT, ctx.attrDefs!);
    return Math.max(0.1, w); // clamp same as AttrDef.clampMin
  });
  const totalWeight = weights.reduce((s, w) => s + w, 0);
  if (totalWeight <= 0) return ctx.rng.pick(candidates);

  let roll = ctx.rng.next() * totalWeight;
  for (let i = 0; i < candidates.length; i++) {
    roll -= weights[i]!;
    if (roll <= 0) return candidates[i]!;
  }
  return candidates[candidates.length - 1]!;
}

// ---------- PriorityListIntent (content-driven) ----------

import { getContent } from "../../content/registry";
import { isPlayer, isEnemy } from "../../entity/actor";
import type { PlayerCharacter, Enemy } from "../../entity/actor";
import { createPriorityListIntent, type PriorityRule } from "./priority";

/**
 * A single shared intent that dynamically resolves intentConfig from content
 * at action time. This avoids per-hero / per-monster intent registration and
 * survives save/load without re-registration.
 *
 * Internally caches the compiled PriorityListIntent per config identity so
 * we don't rebuild every tick.
 */
const _compiledCache = new Map<string, Intent>();

const PriorityListIntent: Intent = (actor, ctx) => {
  let rules: PriorityRule[] = [];
  let cacheKey: string;

  const content = getContent();

  if (isPlayer(actor)) {
    const pc = actor as PlayerCharacter;
    cacheKey = pc.heroConfigId;
    const heroCfg = content.starting?.heroes.find(h => h.id === pc.heroConfigId);
    rules = heroCfg?.intentConfig ?? [];
  } else if (isEnemy(actor)) {
    const e = actor as Enemy;
    cacheKey = e.defId as string;
    const mdef = content.monsters[e.defId as string];
    rules = mdef?.intentConfig ?? [];
  } else {
    return null;
  }

  let compiled = _compiledCache.get(cacheKey);
  if (!compiled) {
    compiled = createPriorityListIntent(rules);
    _compiledCache.set(cacheKey, compiled);
  }
  return compiled(actor, ctx);
};

// ---------- Battle intent builder ----------

/**
 * Build a per-actor intent map for a new battle. All actors use the shared
 * PRIORITY_LIST intent which dynamically reads intentConfig from content.
 *
 * Returns Record<actorId, intentId> suitable for CreateBattleOptions.intents.
 */
export function buildBattleIntents(
  participants: readonly Character[],
): Record<string, string> {
  const intents: Record<string, string> = {};
  for (const actor of participants) {
    intents[actor.id] = INTENT.PRIORITY_LIST;
  }
  return intents;
}

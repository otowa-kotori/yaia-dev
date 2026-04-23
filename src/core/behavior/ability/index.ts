// Ability cast pipeline.
//
// tryUseAbility(caster, abilityId, targets, ctx):
//   1. Validate ability exists on caster.abilities.
//   2. Validate cooldown expired.
//   3. Validate MP cost affordable.
//   4. Validate target list matches ability.targetKind.
//   5. Consume MP, set cooldown.
//   6. For each target, apply each effect in order.
//
// Returns a CastResult describing what happened. Never throws on user-level
// rule violations — returns { ok: false, reason } instead — so UI code and
// intent code can branch on failure modes without try/catch.

import type { AbilityDef, AttrDef } from "../../content/types";
import { getAbility, getEffect } from "../../content/registry";
import type { GameEventBus } from "../../infra/events";
import type { Rng } from "../../infra/rng";
import type { GameState } from "../../infra/state/types";
import type { Character } from "../../entity/actor";
import { isAlive } from "../../entity/actor";
import { applyEffect, type EffectContext } from "../effect";

export interface AbilityContext {
  state: GameState;
  bus: GameEventBus;
  rng: Rng;
  attrDefs: Readonly<Record<string, AttrDef>>;
  currentTick: number;
}

export type CastFailureReason =
  | "unknown_ability"
  | "not_known"
  | "on_cooldown"
  | "insufficient_mp"
  | "caster_dead"
  | "no_valid_targets"
  | "wrong_target_count"
  | "target_wrong_side";

export interface CastSuccess {
  ok: true;
  abilityId: string;
  targets: Character[];
  /** Per-effect magnitudes, flattened across targets. */
  magnitudes: number[];
}

export interface CastFailure {
  ok: false;
  reason: CastFailureReason;
  detail?: string;
}

export type CastResult = CastSuccess | CastFailure;

/**
 * Attempt to cast an ability. See module doc for the full validation order.
 */
export function tryUseAbility(
  caster: Character,
  abilityId: string,
  targets: Character[],
  ctx: AbilityContext,
): CastResult {
  if (!isAlive(caster)) return fail("caster_dead");

  if (!caster.abilities.includes(abilityId as (typeof caster.abilities)[number])) {
    return fail("not_known");
  }

  const def = safeGetAbility(abilityId);
  if (!def) return fail("unknown_ability");

  const cdUntil = caster.cooldowns[abilityId];
  if (cdUntil !== undefined && ctx.currentTick < cdUntil) {
    return fail("on_cooldown", `ready at tick ${cdUntil}`);
  }

  const mpCost = def.cost?.mp ?? 0;
  if (mpCost > 0 && caster.currentMp < mpCost) {
    return fail("insufficient_mp");
  }

  const targetCheck = validateTargets(def, caster, targets);
  if (!targetCheck.ok) return targetCheck;

  // Commit: pay cost, set cooldown.
  if (mpCost > 0) caster.currentMp -= mpCost;
  if (def.cooldownTicks && def.cooldownTicks > 0) {
    caster.cooldowns[abilityId] = ctx.currentTick + def.cooldownTicks;
  }

  const effectCtx: EffectContext = {
    state: ctx.state,
    bus: ctx.bus,
    rng: ctx.rng,
    attrDefs: ctx.attrDefs,
    currentTick: ctx.currentTick,
  };

  const magnitudes: number[] = [];
  for (const target of targets) {
    // Skip dead targets silently — ability already "fired" by paying cost.
    if (!isAlive(target) && def.targetKind !== "self") continue;
    for (const effectId of def.effects) {
      const effect = safeGetEffect(effectId);
      if (!effect) continue;
      magnitudes.push(applyEffect(effect, caster, target, effectCtx));
    }
  }

  return { ok: true, abilityId, targets, magnitudes };
}

// ---------- Internal ----------

function validateTargets(
  def: AbilityDef,
  caster: Character,
  targets: Character[],
): { ok: true } | CastFailure {
  switch (def.targetKind) {
    case "self":
      if (targets.length !== 1 || targets[0] !== caster) {
        return fail("wrong_target_count", "self ability requires [caster] as sole target");
      }
      return { ok: true };

    case "none":
      if (targets.length !== 0) return fail("wrong_target_count");
      return { ok: true };

    case "single_enemy":
      if (targets.length !== 1) return fail("wrong_target_count");
      if (targets[0]!.side === caster.side) return fail("target_wrong_side");
      return { ok: true };

    case "single_ally":
      if (targets.length !== 1) return fail("wrong_target_count");
      if (targets[0]!.side !== caster.side) return fail("target_wrong_side");
      return { ok: true };

    case "all_enemies":
      if (targets.length === 0) return fail("no_valid_targets");
      if (targets.some((t) => t.side === caster.side)) {
        return fail("target_wrong_side");
      }
      return { ok: true };

    case "all_allies":
      if (targets.length === 0) return fail("no_valid_targets");
      if (targets.some((t) => t.side !== caster.side)) {
        return fail("target_wrong_side");
      }
      return { ok: true };
  }
}

function fail(reason: CastFailureReason, detail?: string): CastFailure {
  return { ok: false, reason, ...(detail ? { detail } : {}) };
}

function safeGetAbility(id: string): AbilityDef | undefined {
  try {
    return getAbility(id);
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

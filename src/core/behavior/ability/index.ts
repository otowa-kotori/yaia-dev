// Talent cast pipeline (temporary shim).
//
// This module replaces the old AbilityDef-based tryUseAbility with a
// TalentDef-based tryUseTalent. The validation/dispatch flow is the same;
// cost, cooldown, and targeting now come from TalentDef.getActiveParams.
//
// Phase 3 will move this into behavior/talent with full CastContext support.
// Until then, talents that only declare `effects` (no `execute`) use the
// same apply-each-effect loop as the old AbilityDef pipeline.
//
// Returns a CastResult describing what happened. Never throws on user-level
// rule violations — returns { ok: false, reason } instead — so UI code and
// intent code can branch on failure modes without try/catch.

import type { TalentDef, AttrDef, TargetKind } from "../../content/types";
import { getTalent, getEffect } from "../../content/registry";
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
  | "unknown_talent"
  | "not_known"
  | "on_cooldown"
  | "insufficient_mp"
  | "caster_dead"
  | "no_valid_targets"
  | "wrong_target_count"
  | "target_wrong_side";

export interface CastSuccess {
  ok: true;
  talentId: string;
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
 * Attempt to use a talent. See module doc for the full validation order.
 */
export function tryUseTalent(
  caster: Character,
  talentId: string,
  targets: Character[],
  ctx: AbilityContext,
): CastResult {
  if (!isAlive(caster)) return fail("caster_dead");

  if (!caster.knownTalentIds.includes(talentId as (typeof caster.knownTalentIds)[number])) {
    return fail("not_known");
  }

  const def = safeGetTalent(talentId);
  if (!def) return fail("unknown_talent");
  const activeParams = def.getActiveParams?.(1);
  if (!activeParams) return fail("unknown_talent");

  // Cooldown check: value > 0 means still on cooldown (remaining action count).
  const cdRemaining = caster.cooldowns[talentId];
  if (cdRemaining !== undefined && cdRemaining > 0) {
    return fail("on_cooldown", `${cdRemaining} actions remaining`);
  }

  const mpCost = activeParams.mpCost ?? 0;
  if (mpCost > 0 && caster.currentMp < mpCost) {
    return fail("insufficient_mp");
  }

  const targetCheck = validateTargets(activeParams.targetKind, caster, targets);
  if (!targetCheck.ok) return targetCheck;

  // Commit: pay cost, set cooldown (remaining action count).
  if (mpCost > 0) caster.currentMp -= mpCost;
  if (activeParams.cooldownActions && activeParams.cooldownActions > 0) {
    caster.cooldowns[talentId] = activeParams.cooldownActions;
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
    // Skip dead targets silently — talent already "fired" by paying cost.
    if (!isAlive(target) && activeParams.targetKind !== "self") continue;
    for (const effectId of def.effects ?? []) {
      const effect = safeGetEffect(effectId);
      if (!effect) continue;
      magnitudes.push(applyEffect(effect, caster, target, effectCtx));
    }
  }

  return { ok: true, talentId, targets, magnitudes };
}

// ---------- Internal ----------

function validateTargets(
  targetKind: TargetKind,
  caster: Character,
  targets: Character[],
): { ok: true } | CastFailure {
  switch (targetKind) {
    case "self":
      if (targets.length !== 1 || targets[0] !== caster) {
        return fail("wrong_target_count", "self talent requires [caster] as sole target");
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

function safeGetTalent(id: string): TalentDef | undefined {
  try {
    return getTalent(id);
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

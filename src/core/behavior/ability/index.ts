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

import type {
  TalentDef,
  AttrDef,
  TargetKind,
  TalentExecutionContext,
} from "../../content/types";

import { getTalent, getEffect } from "../../content/registry";
import {
  createTalentExecutionContext,
  createTalentStaticContext,
  getTalentLevel,
  resolveTalentActiveParams,
} from "../../content/talent";

import type { GameEventBus } from "../../infra/events";
import type { Rng } from "../../infra/rng";
import type { GameState } from "../../infra/state/types";
import type { Character, PlayerCharacter } from "../../entity/actor";
import { isAlive, isPlayer, getAttr } from "../../entity/actor";
import { ATTR } from "../../entity/attribute";
import { evalFormula, type FormulaContext } from "../../infra/formula";
import { dispatchReaction, type ReactionContext, type DamageType } from "../../combat/reaction";
import type { Battle } from "../../combat/battle/battle";
import { applyEffect, type EffectContext } from "../effect";

export interface AbilityContext {
  state: GameState;
  bus: GameEventBus;
  rng: Rng;
  attrDefs: Readonly<Record<string, AttrDef>>;
  currentTick: number;
  /** Battle participants — needed for CastContext.aliveEnemies/aliveAllies. */
  participants?: readonly Character[];
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

  // For players, non-basic talents must be equipped to use in combat.
  if (isPlayer(caster)) {
    const pc = caster as PlayerCharacter;
    const def0 = safeGetTalent(talentId);
    // Basic attacks (tpCost 0) are implicitly always available.
    if (def0 && def0.tpCost > 0 && !pc.equippedTalents.includes(talentId)) {
      return fail("not_known", "talent not equipped");
    }
  }

  const def = safeGetTalent(talentId);
  if (!def) return fail("unknown_talent");

  const level = getTalentLevel(caster, talentId);
  const staticCtx = createTalentStaticContext(level, isPlayer(caster) ? caster : null);
  const activeParams = resolveTalentActiveParams(def, staticCtx);
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

  if (def.execute) {
    const participants = ctx.participants ?? [];
    const reactionCtx = createReactionContext(ctx, participants);
    const execCtx = buildTalentExecutionContext(
      level,
      caster,
      targets,
      participants,
      ctx,
      reactionCtx,
    );
    def.execute(execCtx);
    return { ok: true, talentId, targets };
  }


  // Fallback: apply effects[] declaratively.
  // Also constructs a ReactionContext so damage effects trigger reactions
  // (e.g. after_damage_taken for Retaliation).
  const participants = ctx.participants ?? [];
  const reactionCtx = createReactionContext(ctx, participants);
  const effectCtx: EffectContext = {
    state: ctx.state,
    bus: ctx.bus,
    rng: ctx.rng,
    attrDefs: ctx.attrDefs,
    currentTick: ctx.currentTick,
  };

  for (const target of targets) {
    // Skip dead targets silently — talent already "fired" by paying cost.
    if (!isAlive(target) && activeParams.targetKind !== "self") continue;
    for (const effectId of def.effects ?? []) {
      const effect = safeGetEffect(effectId);
      if (!effect) continue;

      // Dispatch before_damage_taken so reactions can modify damage.
      if (effect.magnitudeMode === "damage" && effect.formula) {
        const fctx = buildFormulaContext(caster, target, ctx.attrDefs);
        const rawDamage = Math.max(0, Math.floor(evalFormula(effect.formula, fctx)));
        const result = { finalDamage: rawDamage };
        const damageType: DamageType = effect.formula.kind === "magic_damage_v1" ? "magical" : "physical";

        dispatchReaction(target, {
          kind: "before_damage_taken",
          attacker: caster,
          rawDamage,
          damageType,
          result,
        }, reactionCtx);

        const finalDamage = Math.max(0, result.finalDamage);
        if (finalDamage > 0) {
          target.currentHp = Math.max(0, target.currentHp - finalDamage);
          ctx.bus.emit("damage", {
            attackerId: caster.id,
            targetId: target.id,
            amount: finalDamage,
          });
        }

        dispatchReaction(target, {
          kind: "after_damage_taken",
          attacker: caster,
          damage: finalDamage,
          damageType,
        }, reactionCtx);

        dispatchReaction(caster, {
          kind: "after_damage_dealt",
          target,
          damage: finalDamage,
          damageType,
        }, reactionCtx);

        if (!isAlive(target)) {
          dispatchReaction(caster, { kind: "on_kill", victim: target }, reactionCtx);
        }
      } else {
        // Non-damage effects (buffs, heals, rewards) — apply as before.
        applyEffect(effect, caster, target, effectCtx);
      }
    }
  }

  return { ok: true, talentId, targets };
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

// ---------- TalentExecutionContext + damage pipeline ----------


function buildFormulaContext(
  source: Character,
  target: Character,
  attrDefs: Readonly<Record<string, AttrDef>>,
): FormulaContext {
  return {
    vars: {
      patk: getAttr(source, ATTR.PATK, attrDefs),
      pdef: getAttr(target, ATTR.PDEF, attrDefs),
      matk: getAttr(source, ATTR.MATK, attrDefs),
      mres: getAttr(target, ATTR.MRES, attrDefs),
      source_str: getAttr(source, ATTR.STR, attrDefs),
      source_dex: getAttr(source, ATTR.DEX, attrDefs),
      source_int: getAttr(source, ATTR.INT, attrDefs),
      source_max_hp: getAttr(source, ATTR.MAX_HP, attrDefs),
      source_current_hp: source.currentHp,
      target_max_hp: getAttr(target, ATTR.MAX_HP, attrDefs),
      target_current_hp: target.currentHp,
    },
  };
}

function dealDamageWithReactions(
  caster: Character,
  target: Character,
  coefficient: number,
  damageType: DamageType,
  ctx: AbilityContext,
  reactionCtx: ReactionContext,
): number {
  // 1. Calculate raw damage via formula.
  const formulaKind = damageType === "physical" ? "phys_damage_v1" : "magic_damage_v1";
  const fctx = buildFormulaContext(caster, target, ctx.attrDefs);
  const rawDamage = Math.max(0, Math.floor(evalFormula({ kind: formulaKind, skillMul: coefficient }, fctx)));

  // 2. before_damage_taken reaction (can modify finalDamage).
  const result = { finalDamage: rawDamage };
  dispatchReaction(target, {
    kind: "before_damage_taken",
    attacker: caster,
    rawDamage,
    damageType,
    result,
  }, reactionCtx);

  // 3. Apply damage.
  const finalDamage = Math.max(0, result.finalDamage);
  if (finalDamage > 0) {
    target.currentHp = Math.max(0, target.currentHp - finalDamage);
    ctx.bus.emit("damage", {
      attackerId: caster.id,
      targetId: target.id,
      amount: finalDamage,
    });
  }

  // 4. after_damage_taken + after_damage_dealt reactions.
  dispatchReaction(target, {
    kind: "after_damage_taken",
    attacker: caster,
    damage: finalDamage,
    damageType,
  }, reactionCtx);

  dispatchReaction(caster, {
    kind: "after_damage_dealt",
    target,
    damage: finalDamage,
    damageType,
  }, reactionCtx);

  // 5. on_kill if target died.
  if (!isAlive(target)) {
    dispatchReaction(caster, {
      kind: "on_kill",
      victim: target,
    }, reactionCtx);
  }

  return finalDamage;
}

function buildTalentExecutionContext(
  level: number,
  caster: Character,
  targets: Character[],
  participants: readonly Character[],
  ctx: AbilityContext,
  reactionCtx: ReactionContext,
): TalentExecutionContext {
  return createTalentExecutionContext({
    level,
    caster,
    targets,
    participants,
    state: ctx.state,
    bus: ctx.bus,
    rng: ctx.rng,
    currentTick: ctx.currentTick,
    dealPhysicalDamage(target, coefficient) {
      return dealDamageWithReactions(caster, target, coefficient, "physical", ctx, reactionCtx);
    },
    dealMagicDamage(target, coefficient) {
      return dealDamageWithReactions(caster, target, coefficient, "magical", ctx, reactionCtx);
    },
    applyEffect(effectId, target, state) {
      const eff = getEffect(effectId as string);
      applyEffect(eff, caster, target, { ...ctx, currentTick: ctx.currentTick }, state);
    },
    aliveEnemies() {
      return participants.filter(p => p.side !== caster.side && isAlive(p)) as Character[];
    },
    aliveAllies() {
      return participants.filter(p => p.side === caster.side && p !== caster && isAlive(p)) as Character[];
    },
  });
}


function createReactionContext(
  ctx: AbilityContext,
  participants: readonly Character[],
  battle?: Battle,
): ReactionContext {
  const reactionCtx: ReactionContext = {
    dealPhysicalDamage(source, target, coefficient) {
      return dealDamageWithReactions(source, target, coefficient, "physical", ctx, reactionCtx);
    },
    dealMagicDamage(source, target, coefficient) {
      return dealDamageWithReactions(source, target, coefficient, "magical", ctx, reactionCtx);
    },
    dealDamage(source, target, amount, _damageType) {
      // Flat damage for redirected / already-resolved damage.
      const dmg = Math.max(0, Math.floor(amount));
      if (dmg > 0) {
        target.currentHp = Math.max(0, target.currentHp - dmg);
        ctx.bus.emit("damage", { attackerId: source.id, targetId: target.id, amount: dmg });
      }
    },
    healTarget(target, amount) {
      const maxHp = getAttr(target, ATTR.MAX_HP, ctx.attrDefs);
      target.currentHp = Math.min(maxHp, target.currentHp + Math.max(0, Math.floor(amount)));
    },
    applyEffect(effectId, source, target, _state) {
      // Simplified: just apply via the effect pipeline
      const eff = safeGetEffect(effectId as string);
      if (eff) applyEffect(eff, source, target, { ...ctx, currentTick: ctx.currentTick });
    },
    removeEffect(_owner, _state) {
      // TODO: implement effect removal by state reference
    },
    activeReactionKeys: new Set(),
    reactionDepth: 0,
    rng: ctx.rng,
    attrDefs: ctx.attrDefs,
    bus: ctx.bus,
    state: ctx.state,
    battle: battle as unknown as Battle,  // may be undefined in non-battle context
    participants,
  };
  return reactionCtx;
}


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
import type { FormulaRef } from "../../infra/formula/types";
import {
  dispatchReaction,
  type PhysicalDamageDealOptions,
  type ReactionContext,
  type DamageType,
} from "../../combat/reaction";
import type { Battle } from "../../combat/battle/battle";
import { applyEffect, type EffectContext } from "../effect";

export interface AbilityContext {
  state: GameState;
  bus: GameEventBus;
  rng: Rng;
  currentTick: number;
  /** Battle participants — needed for CastContext.aliveEnemies/aliveAllies. */
  participants?: readonly Character[];
  /** Reaction dispatch context. Created inside tryUseTalent after validation;
   *  available to all downstream damage/hit/crit functions. */
  reactionCtx?: ReactionContext;
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

  const targetCheck = validateTargets(
    activeParams.targetKind,
    activeParams.maxTargets,
    caster,
    targets,
  );
  if (!targetCheck.ok) return targetCheck;

  // Commit: pay cost, set cooldown (remaining action count).
  if (mpCost > 0) caster.currentMp -= mpCost;
  if (activeParams.cooldownActions && activeParams.cooldownActions > 0) {
    // Cooldowns are decremented at the end of each owner action window.
    // Store +1 so "cooldownActions = N" means waiting N full future actions.
    caster.cooldowns[talentId] = activeParams.cooldownActions + 1;
  }

  if (def.execute) {
    const participants = ctx.participants ?? [];
    const reactionCtx = createReactionContext(ctx, participants);
    ctx.reactionCtx = reactionCtx;
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
  ctx.reactionCtx = reactionCtx;
  const effectCtx: EffectContext = {
    state: ctx.state,
    bus: ctx.bus,
    rng: ctx.rng,
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
        // Hit check — miss skips this effect entirely.
        if (!rollHit(caster, target, ctx)) {
          ctx.bus.emit("damage", {
            attackerId: caster.id,
            targetId: target.id,
            amount: 0,
            isMiss: true,
            isCrit: false,
          });
          continue;
        }

        const fctx = buildFormulaContext(caster, target);
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

        let finalDamage = Math.max(0, result.finalDamage);

        // Crit check (after armor, after before_damage_taken).
        let isCrit = false;
        if (finalDamage > 0) {
          const crit = rollCrit(caster, target, ctx);
          if (crit.isCrit) {
            isCrit = true;
            finalDamage = Math.floor(finalDamage * crit.mult);
          }
        }

        if (finalDamage > 0) {
          target.currentHp = Math.max(0, target.currentHp - finalDamage);
        }
        ctx.bus.emit("damage", {
          attackerId: caster.id,
          targetId: target.id,
          amount: finalDamage,
          isMiss: false,
          isCrit,
        });

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
  maxTargets: number,
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
      if (targets.length > maxTargets) return fail("wrong_target_count");
      if (targets.some((t) => t.side === caster.side)) {
        return fail("target_wrong_side");
      }
      return { ok: true };

    case "all_allies":
      if (targets.length === 0) return fail("no_valid_targets");
      if (targets.length > maxTargets) return fail("wrong_target_count");
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

// ---------- Hit / Crit helpers ----------

/**
 * Roll a hit check using the hit_rate_v1 formula.
 * Returns true if the attack hits, false if it misses.
 * Dispatches resolve_hit_rate reaction on the attacker, allowing effects
 * to override the rate (e.g. "guaranteed hit" buff).
 */
function rollHit(
  attacker: Character,
  defender: Character,
  ctx: AbilityContext,
): boolean {
  const baseRate = evalFormula(
    { kind: "hit_rate_v1" } as FormulaRef,
    { vars: { hit: getAttr(attacker, ATTR.HIT), eva: getAttr(defender, ATTR.EVA) } },
  );
  const result = { rate: baseRate };
  if (ctx.reactionCtx) {
    dispatchReaction(attacker, { kind: "resolve_hit_rate", target: defender, result }, ctx.reactionCtx);
  }
  return ctx.rng.next() < result.rate;
}

/**
 * Roll a crit check using the crit_rate_v1 formula.
 * Returns { isCrit, mult } where mult is CRIT_MULT if crit, 1 otherwise.
 * Dispatches resolve_crit_rate reaction on the attacker, allowing effects
 * to override the rate (e.g. "guaranteed crit" buff or "suppress crit" debuff).
 */
function rollCrit(
  attacker: Character,
  defender: Character,
  ctx: AbilityContext,
): { isCrit: boolean; mult: number } {
  const baseRate = evalFormula(
    { kind: "crit_rate_v1" } as FormulaRef,
    { vars: {
      crit_rate: getAttr(attacker, ATTR.CRIT_RATE),
      crit_res: getAttr(defender, ATTR.CRIT_RES),
    }},
  );
  const result = { rate: baseRate };
  if (ctx.reactionCtx) {
    dispatchReaction(attacker, { kind: "resolve_crit_rate", target: defender, result }, ctx.reactionCtx);
  }
  if (ctx.rng.next() < result.rate) {
    return { isCrit: true, mult: getAttr(attacker, ATTR.CRIT_MULT) };
  }
  return { isCrit: false, mult: 1 };
}

/**
 * Heal with crit check. Healing does not check hit, but can crit.
 * Uses the same crit_rate_v1 formula as damage.
 */
export function healWithCrit(
  source: Character,
  target: Character,
  baseAmount: number,
  ctx: AbilityContext,
): number {
  let amount = Math.max(0, Math.floor(baseAmount));
  const { isCrit, mult } = rollCrit(source, target, ctx);
  if (isCrit) {
    amount = Math.floor(amount * mult);
  }
  const maxHp = getAttr(target, ATTR.MAX_HP);
  const actual = Math.min(amount, maxHp - target.currentHp);
  if (actual > 0) {
    target.currentHp += actual;
  }
  ctx.bus.emit("heal", {
    sourceId: source.id,
    targetId: target.id,
    amount: actual,
    isCrit,
  });
  return actual;
}

function buildFormulaContext(
  source: Character,
  target: Character,
): FormulaContext {
  return {
    vars: {
      patk: getAttr(source, ATTR.PATK),
      pdef: getAttr(target, ATTR.PDEF),
      matk: getAttr(source, ATTR.MATK),
      mres: getAttr(target, ATTR.MRES),
      source_str: getAttr(source, ATTR.STR),
      source_dex: getAttr(source, ATTR.DEX),
      source_int: getAttr(source, ATTR.INT),
      source_max_hp: getAttr(source, ATTR.MAX_HP),
      source_current_hp: source.currentHp,
      target_max_hp: getAttr(target, ATTR.MAX_HP),
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
  physicalOpts?: PhysicalDamageDealOptions,
): number {
  // 1. Hit check — miss skips all damage and reactions.
  if (!rollHit(caster, target, ctx)) {
    ctx.bus.emit("damage", {
      attackerId: caster.id,
      targetId: target.id,
      amount: 0,
      isMiss: true,
      isCrit: false,
    });
    return 0;
  }

  // 2. Calculate raw damage via formula (includes armor reduction for physical).
  const formulaKind = damageType === "physical" ? "phys_damage_v1" : "magic_damage_v1";
  const baseCtx = buildFormulaContext(caster, target);
  const vars: Record<string, number> = { ...baseCtx.vars };
  if (damageType === "physical") {
    // Same pattern as resolve_hit_rate / resolve_crit_rate: seed a mutable result,
    // let attacker effects react, then feed formula vars (tests/content may use reactions).
    const seed =
      physicalOpts?.patkOverride !== undefined
        ? physicalOpts.patkOverride
        : getAttr(caster, ATTR.PATK);
    const patkResult = { patk: seed };
    dispatchReaction(
      caster,
      { kind: "resolve_physical_damage_patk", target, result: patkResult },
      reactionCtx,
    );
    vars.patk = Math.max(0, patkResult.patk);
  }
  const fctx: FormulaContext = { vars };
  const rawDamage = Math.max(0, Math.floor(evalFormula({ kind: formulaKind, skillMul: coefficient }, fctx)));

  // 3. before_damage_taken reaction (can modify finalDamage).
  const result = { finalDamage: rawDamage };
  dispatchReaction(target, {
    kind: "before_damage_taken",
    attacker: caster,
    rawDamage,
    damageType,
    result,
  }, reactionCtx);

  let finalDamage = Math.max(0, result.finalDamage);

  // 4. Crit check (after armor reduction, after before_damage_taken).
  let isCrit = false;
  if (finalDamage > 0) {
    const crit = rollCrit(caster, target, ctx);
    if (crit.isCrit) {
      isCrit = true;
      finalDamage = Math.floor(finalDamage * crit.mult);
    }
  }

  // 5. Apply damage.
  if (finalDamage > 0) {
    target.currentHp = Math.max(0, target.currentHp - finalDamage);
  }
  ctx.bus.emit("damage", {
    attackerId: caster.id,
    targetId: target.id,
    amount: finalDamage,
    isMiss: false,
    isCrit,
  });

  // 6. after_damage_taken + after_damage_dealt reactions.
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

  // 7. on_kill if target died.
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
    dealPhysicalDamage(target, coefficient, opts) {
      return dealDamageWithReactions(caster, target, coefficient, "physical", ctx, reactionCtx, opts);
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
    dealPhysicalDamage(source, target, coefficient, opts) {
      return dealDamageWithReactions(source, target, coefficient, "physical", ctx, reactionCtx, opts);
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
      const maxHp = getAttr(target, ATTR.MAX_HP);
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
    bus: ctx.bus,
    state: ctx.state,
    battle: battle as unknown as Battle,  // may be undefined in non-battle context
    participants,
  };
  return reactionCtx;
}


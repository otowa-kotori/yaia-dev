import { getEffect } from "../../content/registry";
import { getAttr, type Character } from "../../entity/actor";
import { addModifiers, ATTR, removeModifiersBySource } from "../../entity/attribute";
import { applyTickResourceRegen } from "../../entity/resource";
import type { EffectInstance } from "../../infra/state/types";
import type { ActivityContext } from "./types";
import { TICK_MS } from "../../infra/tick";

export const LOGIC_TICKS_PER_SECOND = Math.round(1000 / TICK_MS);

export const COMBAT_ZONE_RECOVERY_RULES = {
  /** 固定 5 秒搜索 / 休整时间。 */
  searchTicks: 5 * LOGIC_TICKS_PER_SECOND,
  /** 搜索阶段总计恢复的 HP 比例。 */
  interWaveRecoverHpPct: 0.3,
  /** 搜索阶段总计恢复的 MP 比例。 */
  interWaveRecoverMpPct: 0.3,
  /** 角色死亡后，全队需要额外等待的复活时间。 */
  deathRespawnTicks: 8 * LOGIC_TICKS_PER_SECOND,
} as const;

export const DUNGEON_RECOVERY_RULES = {
  /** 副本波间固定短休整。 */
  waveRestTicks: 2 * LOGIC_TICKS_PER_SECOND,
  /** 波间总计恢复的 HP 比例。 */
  interWaveRecoverHpPct: 0.15,
  /** 波间总计恢复的 MP 比例。 */
  interWaveRecoverMpPct: 0.15,
} as const;

export const PHASE_RECOVERY_EFFECT_ID = "effect.system.phase_recovery";
export const PHASE_RECOVERY_SOURCE_PREFIX = "activity.phase_recovery:";

export interface PhaseRecoveryEffectOptions {
  sourceId: string;
  totalTicks: number;
  hpPct: number;
  mpPct: number;
}

export function applyActorResourceRegen(
  actor: Character,
  ctx: ActivityContext,
): void {
  applyTickResourceRegen(actor, ctx.attrDefs);
}

export function ensurePhaseRecoveryEffect(
  actor: Character,
  ctx: ActivityContext,
  opts: PhaseRecoveryEffectOptions,
): void {
  if (actor.currentHp <= 0) {
    removePhaseRecoveryEffect(actor, opts.sourceId);
    return;
  }

  const nextState = buildPhaseRecoveryState(actor, ctx, opts);
  const existing = actor.activeEffects.find((ae) => ae.sourceId === opts.sourceId);
  if (existing && isSameRecoveryState(existing, nextState)) {
    return;
  }

  removePhaseRecoveryEffect(actor, opts.sourceId);

  const effect = getEffect(PHASE_RECOVERY_EFFECT_ID);
  const modifiers = (effect.computeModifiers
    ? effect.computeModifiers(nextState)
    : (effect.modifiers ?? [])).map((modifier) => ({
      ...modifier,
      sourceId: opts.sourceId,
    }));

  if (modifiers.length === 0) return;

  const instance: EffectInstance = {
    effectId: effect.id as string,
    sourceId: opts.sourceId,
    sourceActorId: actor.id,
    remainingActions: -1,
    stacks: 1,
    state: nextState,
  };
  actor.activeEffects.push(instance);
  addModifiers(actor.attrs, modifiers);
}

export function removePhaseRecoveryEffect(
  actor: Character,
  sourceId: string,
): void {
  removeModifiersBySource(actor.attrs, sourceId);
  actor.activeEffects = actor.activeEffects.filter((ae) => ae.sourceId !== sourceId);
}

export function clearPhaseRecoveryEffects(actor: Character): void {
  const phaseEffects = actor.activeEffects.filter((ae) =>
    ae.sourceId.startsWith(PHASE_RECOVERY_SOURCE_PREFIX),
  );
  for (const effect of phaseEffects) {
    removeModifiersBySource(actor.attrs, effect.sourceId);
  }
  actor.activeEffects = actor.activeEffects.filter(
    (ae) => !ae.sourceId.startsWith(PHASE_RECOVERY_SOURCE_PREFIX),
  );
}

export function restoreActorToFull(actor: Character, ctx: ActivityContext): void {
  actor.currentHp = getAttr(actor, ATTR.MAX_HP, ctx.attrDefs);
  actor.currentMp = getAttr(actor, ATTR.MAX_MP, ctx.attrDefs);
}

function buildPhaseRecoveryState(
  actor: Character,
  ctx: ActivityContext,
  opts: PhaseRecoveryEffectOptions,
): Record<string, number> {
  const totalTicks = Math.max(1, opts.totalTicks);
  return {
    hpRegen:
      Math.max(0, getAttr(actor, ATTR.MAX_HP, ctx.attrDefs)) *
      Math.max(0, opts.hpPct) /
      totalTicks,
    mpRegen:
      Math.max(0, getAttr(actor, ATTR.MAX_MP, ctx.attrDefs)) *
      Math.max(0, opts.mpPct) /
      totalTicks,
  };
}

function isSameRecoveryState(
  effect: EffectInstance,
  nextState: Record<string, number>,
): boolean {
  return Number(effect.state.hpRegen ?? 0) === nextState.hpRegen
    && Number(effect.state.mpRegen ?? 0) === nextState.mpRegen;
}

import { getEffect } from "../../content/registry";
import { getAttr, type Character } from "../../entity/actor";
import { addModifiers, ATTR, removeModifiersBySource } from "../../entity/attribute";
import { applyOutOfCombatPctRecovery } from "../../entity/resource";
import type { EffectInstance } from "../../infra/state/types";
import type { ActivityContext } from "./types";
import { TICK_MS } from "../../infra/tick";

export const LOGIC_TICKS_PER_SECOND = Math.round(1000 / TICK_MS);

export const COMBAT_ZONE_ACTIVITY_RULES = {
  /** 搜怪阶段固定 10 秒窗口。 */
  searchTicks: 10 * LOGIC_TICKS_PER_SECOND,
  /** 角色死亡后，全队需要额外等待的复活时间。 */
  deathRespawnTicks: 30 * LOGIC_TICKS_PER_SECOND,
} as const;

export const DUNGEON_RECOVERY_RULES = {
  /** 副本波间固定短休整。 */
  waveRestTicks: 2 * LOGIC_TICKS_PER_SECOND,
} as const;

export const PHASE_RECOVERY_SOURCE_PREFIX = "activity.phase_recovery:";
export const OUT_OF_COMBAT_RECOVERY_EFFECT_ID =
  "effect.system.out_of_combat_recovery";
export const COMBAT_SEARCH_RECOVERY_EFFECT_ID =
  "effect.system.combat_search_recovery";
export const DUNGEON_WAVE_REST_RECOVERY_EFFECT_ID =
  "effect.system.dungeon_wave_rest_recovery";

export function applyActorOutOfCombatRecovery(
  actor: Character,
  ctx: ActivityContext,
): void {
  applyOutOfCombatPctRecovery(actor);
}

export function ensureRecoveryEffect(
  actor: Character,
  ctx: ActivityContext,
  sourceId: string,
  effectId: string,
): void {
  if (actor.currentHp <= 0) {
    removePhaseRecoveryEffect(actor, sourceId);
    return;
  }

  const existing = actor.activeEffects.find((ae) => ae.sourceId === sourceId);
  if (existing?.effectId === effectId) {
    return;
  }

  removePhaseRecoveryEffect(actor, sourceId);

  const effect = getEffect(effectId);
  const modifiers = (effect.computeModifiers
    ? effect.computeModifiers({})
    : (effect.modifiers ?? [])).map((modifier) => ({
      ...modifier,
      sourceId,
    }));

  if (modifiers.length === 0) return;

  const instance: EffectInstance = {
    effectId: effect.id as string,
    sourceId,
    sourceActorId: actor.id,
    remainingActions: -1,
    stacks: 1,
    state: {},
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
  actor.currentHp = getAttr(actor, ATTR.MAX_HP);
  actor.currentMp = getAttr(actor, ATTR.MAX_MP);
}

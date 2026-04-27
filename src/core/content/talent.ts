import type {
  TalentActiveParams,
  TalentDef,
  TalentExecutionContext,
  TalentStaticContext,
} from "./types";
import type { Character, PlayerCharacter } from "../entity/actor/types";
import { isPlayer } from "../entity/actor/types";
import type { GameEventBus } from "../infra/events";
import type { Rng } from "../infra/rng";
import type { GameState } from "../infra/state/types";
import type { EffectId } from "./types";

export const DEFAULT_TALENT_MP_COST = 0;
export const DEFAULT_TALENT_COOLDOWN_ACTIONS = 0;
export const DEFAULT_TALENT_ACTION_COST_RATIO = 1;

export interface ResolvedTalentActiveParams {
  targetKind: TalentActiveParams["targetKind"];
  mpCost: number;
  cooldownActions: number;
  actionCostRatio: number;
  maxTargets: number;
}

export interface CreateTalentExecutionContextArgs {
  level: number;
  caster: Character;
  targets: Character[];
  participants: readonly Character[];
  state: GameState;
  bus: GameEventBus;
  rng: Rng;
  currentTick: number;
  dealPhysicalDamage(target: Character, coefficient: number): number;
  dealMagicDamage(target: Character, coefficient: number): number;
  applyEffect(effectId: EffectId, target: Character, state: Record<string, unknown>): void;
  aliveEnemies(): Character[];
  aliveAllies(): Character[];
}

export function createTalentStaticContext(
  level: number,
  owner: PlayerCharacter | null,
): TalentStaticContext {
  return { level, owner };
}

export function createTalentExecutionContext(
  args: CreateTalentExecutionContextArgs,
): TalentExecutionContext {
  return {
    level: args.level,
    owner: isPlayer(args.caster) ? args.caster : null,
    caster: args.caster,
    targets: args.targets,
    participants: args.participants,
    state: args.state,
    bus: args.bus,
    rng: args.rng,
    currentTick: args.currentTick,
    dealPhysicalDamage: args.dealPhysicalDamage,
    dealMagicDamage: args.dealMagicDamage,
    applyEffect: args.applyEffect,
    aliveEnemies: args.aliveEnemies,
    aliveAllies: args.aliveAllies,
  };
}

export function resolveTalentActiveParams(
  def: TalentDef,
  ctx: TalentStaticContext,
): ResolvedTalentActiveParams | null {
  const activeParams = def.getActiveParams?.(ctx);
  if (!activeParams) return null;

  const mpCost = activeParams.mpCost ?? DEFAULT_TALENT_MP_COST;
  if (!Number.isFinite(mpCost) || mpCost < 0) {
    throw new Error(`talent ${def.id}: invalid mpCost ${mpCost}`);
  }

  const cooldownActions = activeParams.cooldownActions ?? DEFAULT_TALENT_COOLDOWN_ACTIONS;
  if (!Number.isFinite(cooldownActions) || cooldownActions < 0) {
    throw new Error(`talent ${def.id}: invalid cooldownActions ${cooldownActions}`);
  }

  const actionCostRatio = activeParams.actionCostRatio ?? DEFAULT_TALENT_ACTION_COST_RATIO;
  if (!Number.isFinite(actionCostRatio) || actionCostRatio <= 0) {
    throw new Error(`talent ${def.id}: invalid actionCostRatio ${actionCostRatio}`);
  }

  const defaultMaxTargets = defaultMaxTargetsByKind(activeParams.targetKind);
  const maxTargets = activeParams.maxTargets ?? defaultMaxTargets;
  if (!Number.isInteger(maxTargets) || maxTargets < 0) {
    throw new Error(`talent ${def.id}: invalid maxTargets ${maxTargets}`);
  }
  if (maxTargets > defaultMaxTargets) {
    throw new Error(
      `talent ${def.id}: maxTargets ${maxTargets} violates targetKind "${activeParams.targetKind}" upper bound ${defaultMaxTargets}`,
    );
  }

  return {
    targetKind: activeParams.targetKind,
    mpCost,
    cooldownActions,
    actionCostRatio,
    maxTargets,
  };
}

export function getTalentLevel(actor: Character, talentId: string): number {
  return isPlayer(actor) ? actor.talentLevels[talentId] ?? 1 : 1;
}

function defaultMaxTargetsByKind(
  targetKind: TalentActiveParams["targetKind"],
): number {
  switch (targetKind) {
    case "none":
      return 0;
    case "self":
    case "single_enemy":
    case "single_ally":
      return 1;
    case "all_enemies":
    case "all_allies":
      return Number.POSITIVE_INFINITY;
  }
}

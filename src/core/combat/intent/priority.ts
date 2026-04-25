// PriorityListIntent — rule-based combat AI.
//
// A priority list is an ordered array of PriorityRule objects. On each action
// window, the intent walks the list top-to-bottom and picks the first rule
// whose conditions are all met and whose talent can find valid targets. If no
// rule matches, falls through to a basic attack.
//
// This provides flexible per-character AI without touching Battle or the
// tryUseTalent pipeline. Content can define different priority lists for
// different hero classes (e.g. knight: Warcry > Power Strike > Attack).
//
// Usage:
//   const intent = createPriorityListIntent([
//     { talentId: "talent.knight.warcry", conditions: ["off_cooldown", "has_mp"] },
//     { talentId: "talent.knight.power_strike", conditions: ["off_cooldown", "has_mp"] },
//   ]);
//   registerIntent("intent.knight_priority", intent);

import type { Character, PlayerCharacter } from "../../entity/actor/types";
import { isPlayer } from "../../entity/actor/types";
import { getTalent } from "../../content/registry";
import type { Intent, IntentAction, IntentContext } from "./index";
import { enemiesOf, alliesOf, pickWeightedTarget } from "./index";

// ---------- Public types ----------

/**
 * How to pick targets for a rule.
 *   "random_enemy"    — random alive enemy (default)
 *   "lowest_hp_enemy" — alive enemy with lowest current HP
 *   "self"            — caster only
 *   "all_enemies"     — all alive enemies
 *   "random_ally"     — random alive ally (not self)
 *   "lowest_hp_ally"  — alive ally with lowest current HP
 */
export type TargetPolicy =
  | "random_enemy"
  | "lowest_hp_enemy"
  | "self"
  | "all_enemies"
  | "random_ally"
  | "lowest_hp_ally";

/**
 * Conditions that must all be true for a rule to fire.
 *   "off_cooldown"   — talent cooldown <= 0
 *   "has_mp"         — caster.currentMp >= talent's mpCost
 */
export type UseCondition =
  | "off_cooldown"
  | "has_mp";

export interface PriorityRule {
  talentId: string;
  /** Target selection strategy. Default "random_enemy". */
  targetPolicy?: TargetPolicy;
  /** All conditions must be met for this rule to fire. Default []. */
  conditions?: UseCondition[];
}

// ---------- Factory ----------

/**
 * Create a PriorityListIntent. The returned Intent walks the rules array
 * top-to-bottom each action window and returns the first viable action.
 * Falls through to basic attack (first knownTalentId) if no rule matches.
 */
export function createPriorityListIntent(rules: PriorityRule[]): Intent {
  return (actor: Character, ctx: IntentContext): IntentAction | null => {
    for (const rule of rules) {
      const action = tryRule(rule, actor, ctx);
      if (action) return action;
    }

    // Fallback: basic attack (first talent → random enemy).
    if (actor.knownTalentIds.length === 0) return null;
    const enemies = enemiesOf(actor, ctx.participants);
    if (enemies.length === 0) return null;
    return {
      talentId: actor.knownTalentIds[0]! as string,
      targets: [ctx.rng.pick(enemies)],
    };
  };
}

// ---------- Internal ----------

function tryRule(
  rule: PriorityRule,
  actor: Character,
  ctx: IntentContext,
): IntentAction | null {
  const talentId = rule.talentId;

  // Check the actor actually knows this talent.
  if (!actor.knownTalentIds.includes(talentId as any)) return null;

  // Resolve talent def for condition checks.
  let talentDef;
  try { talentDef = getTalent(talentId); } catch { return null; }
  const level = isPlayer(actor)
    ? ((actor as PlayerCharacter).talentLevels[talentId] ?? 1)
    : 1;
  const activeParams = talentDef.getActiveParams?.(level);
  if (!activeParams) return null; // not an active talent

  // Check conditions.
  const conditions = rule.conditions ?? [];
  for (const cond of conditions) {
    if (!checkCondition(cond, talentId, actor, activeParams)) return null;
  }

  // Resolve targets.
  const policy = rule.targetPolicy ?? "random_enemy";
  const targets = resolveTargets(policy, actor, ctx);
  if (!targets || targets.length === 0) return null;

  return { talentId, targets };
}

function checkCondition(
  cond: UseCondition,
  talentId: string,
  actor: Character,
  activeParams: { mpCost: number; cooldownActions: number; energyCost: number; targetKind: string },
): boolean {
  switch (cond) {
    case "off_cooldown": {
      const cdRemaining = actor.cooldowns[talentId] ?? 0;
      return cdRemaining <= 0;
    }
    case "has_mp":
      return actor.currentMp >= activeParams.mpCost;
    default:
      return true;
  }
}

function resolveTargets(
  policy: TargetPolicy,
  actor: Character,
  ctx: IntentContext,
): Character[] | null {
  switch (policy) {
    case "random_enemy": {
      const enemies = enemiesOf(actor, ctx.participants);
      if (enemies.length === 0) return null;
      return [pickWeightedTarget(enemies, ctx)];
    }
    case "lowest_hp_enemy": {
      const enemies = enemiesOf(actor, ctx.participants);
      if (enemies.length === 0) return null;
      enemies.sort((a, b) => a.currentHp - b.currentHp);
      return [enemies[0]!];
    }
    case "self":
      return [actor];
    case "all_enemies": {
      const enemies = enemiesOf(actor, ctx.participants);
      if (enemies.length === 0) return null;
      return enemies;
    }
    case "random_ally": {
      const allies = alliesOf(actor, ctx.participants);
      if (allies.length === 0) return null;
      return [ctx.rng.pick(allies)];
    }
    case "lowest_hp_ally": {
      const allies = alliesOf(actor, ctx.participants);
      if (allies.length === 0) return null;
      allies.sort((a, b) => a.currentHp - b.currentHp);
      return [allies[0]!];
    }
  }
}

// Character-level XP system.
//
// Each PlayerCharacter carries its own xpCurve. Skill XP reads the curve
// from the SkillDef passed by the caller. No fallbacks — missing data
// throws loudly (alpha-stage discipline).

import { evalFormula } from "../formula/eval";
import type { FormulaRef } from "../formula/types";
import type { SkillDef, SkillId } from "../content/types";
import type { GameEventBus } from "../events";
import type { PlayerCharacter } from "../actor";
import type { SkillProgress } from "../state/types";

export interface GrantXpContext {
  bus: GameEventBus;
}

/**
 * Grant character XP, advancing `level` / `exp` in place. Cascades multiple
 * level-ups in one call. Emits 'levelup' once per level gained. Returns
 * the number of levels gained.
 */
export function grantCharacterXp(
  pc: PlayerCharacter,
  amount: number,
  ctx: GrantXpContext,
): number {
  if (amount <= 0) return 0;
  pc.exp += amount;

  let gained = 0;
  while (pc.level < pc.maxLevel) {
    const cost = xpCostToReach(pc.level + 1, pc.xpCurve);
    if (pc.exp < cost) break;
    pc.exp -= cost;
    pc.level += 1;
    gained += 1;
    ctx.bus.emit("levelup", { charId: pc.id, level: pc.level });
  }
  return gained;
}

/**
 * Grant XP to a specific skill. SkillDef provides the curve + maxLevel. The
 * skill's entry on the character is lazily created if missing.
 */
export function grantSkillXp(
  pc: PlayerCharacter,
  skillDef: SkillDef,
  amount: number,
  ctx: GrantXpContext,
): number {
  if (amount <= 0) return 0;
  const maxLevel = skillDef.maxLevel ?? 99;
  const key = skillDef.id as unknown as SkillId;

  let sp: SkillProgress | undefined = pc.skills[key];
  if (!sp) {
    sp = { xp: 0, level: 1 };
    pc.skills[key] = sp;
  }
  sp.xp += amount;

  let gained = 0;
  while (sp.level < maxLevel) {
    const cost = xpCostToReach(sp.level + 1, skillDef.xpCurve);
    if (sp.xp < cost) break;
    sp.xp -= cost;
    sp.level += 1;
    gained += 1;
    ctx.bus.emit("levelup", { charId: `${pc.id}:${skillDef.id}`, level: sp.level });
  }
  return gained;
}

/**
 * XP required to progress from (level-1) to level. `level` is 1-based.
 * Level 1 always costs 0 (a new character starts at level 1 with 0 exp).
 */
export function xpCostToReach(level: number, curve: FormulaRef): number {
  if (level <= 1) return 0;
  return Math.max(1, evalFormula(curve, { vars: { level } }));
}

/** Convenience for UI progress bars: exp / cost ratio and absolute cost. */
export function xpProgressToNextLevel(
  currentLevel: number,
  currentExp: number,
  curve: FormulaRef,
): { cost: number; pct: number } {
  const cost = xpCostToReach(currentLevel + 1, curve);
  if (cost <= 0) return { cost: 0, pct: 0 };
  return { cost, pct: Math.max(0, Math.min(1, currentExp / cost)) };
}

// Character-level XP system.
//
// Each PlayerCharacter carries its own xpCurve. Skill XP reads the curve
// from the SkillDef passed by the caller. Character and skill progression
// may use different formula kinds; this module stays curve-agnostic and only
// asks evalFormula() for the next-level cost. No fallbacks — missing data
// throws loudly (alpha-stage discipline).
//
// 属性成长：
//   升级时从 HeroConfig.growth 读取每级增量，直接追加到 pc.attrs.base。
//   小数成长合法（integer: true 的属性在 getAttr 时 floor），由 content 层配置。
//   invalidateAttrs 在成长应用后由调用方（session / rebuildCharacterDerived）统一处理；
//   这里只改 base 值，不主动刷缓存，避免在一次 grantCharacterXp 里连续升多级时
//   重复计算。调用方在完整升级流程结束后做一次 rebuildCharacterDerived 即可。


import { evalFormula } from "../../infra/formula/eval";
import type { FormulaRef } from "../../infra/formula/types";
import type { SkillDef, SkillId } from "../../content/types";
import type { GameEventBus } from "../../infra/events";
import type { PlayerCharacter } from "../../entity/actor";
import type { SkillProgress } from "../../infra/state/types";
import { getContent } from "../../content/registry";
import { autoLearnTalent } from "../talent";

export interface GrantXpContext {
  bus: GameEventBus;
}

/**
 * Grant character XP, advancing `level` / `exp` in place. Cascades multiple
 * level-ups in one call. Emits 'levelup' once per level gained. Returns
 * the number of levels gained.
 *
 * 每次升级会从 HeroConfig.growth 中读取增量，写入 pc.attrs.base。
 * 完整升级流程结束后，调用方（session）负责调用 rebuildCharacterDerived
 * 刷新派生属性缓存。
 */
export function grantCharacterXp(
  pc: PlayerCharacter,
  amount: number,
  ctx: GrantXpContext,
): number {
  if (amount <= 0) return 0;
  pc.exp += amount;

  // 查一次 HeroConfig 的 growth 表，避免在多级循环里重复查找。
  const heroCfg = getContent().starting?.heroes.find((h) => h.id === pc.heroConfigId);
  const growth = heroCfg?.growth ?? {};

  let gained = 0;
  while (pc.level < pc.maxLevel) {
    const cost = xpCostToReach(pc.level + 1, pc.xpCurve);
    if (pc.exp < cost) break;
    pc.exp -= cost;
    pc.level += 1;
    gained += 1;

    // 应用属性成长：直接追加到 base，等价于"这一级赚到的属性点"。
    // invalidateAttrs 由调用方在全部升级完成后统一执行。
    for (const [attrId, delta] of Object.entries(growth)) {
      if (typeof delta === "number" && delta !== 0) {
        pc.attrs.base[attrId] = (pc.attrs.base[attrId] ?? 0) + delta;
      }
    }

    ctx.bus.emit("levelup", {
      kind: "character",
      charId: pc.id,
      level: pc.level,
    });

    // 自动学习技能：检查 HeroConfig.learnList，学习匹配当前等级的技能。
    if (heroCfg?.learnList) {
      const content = getContent();
      for (const entry of heroCfg.learnList) {
        if (entry.level === pc.level) {
          autoLearnTalent(pc, entry.talentId, content);
        }
      }
    }
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
    ctx.bus.emit("levelup", {
      kind: "skill",
      charId: pc.id,
      skillId: skillDef.id,
      level: sp.level,
    });
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

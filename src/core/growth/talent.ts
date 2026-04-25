// Talent point allocation.
//
// TP (Talent Points) are derived from character level: totalTp = (level - 1) * 3.
// Players allocate TP into talents to raise their level. Each talent level costs
// tpCost TP. Prerequisites (talent X at level Y) must be met before allocation.

import type { PlayerCharacter } from "../entity/actor/types";
import type { ContentDb, TalentId, TalentDef } from "../content/types";

export function computeTotalTp(level: number): number {
  return (level - 1) * 3;
}

export function computeSpentTp(
  talentLevels: Record<string, number>,
  talentDefs: Readonly<Record<string, TalentDef>>,
): number {
  let spent = 0;
  for (const [id, lvl] of Object.entries(talentLevels)) {
    const def = talentDefs[id];
    if (def && lvl > 0) spent += def.tpCost * lvl;
  }
  return spent;
}

export function computeAvailableTp(
  level: number,
  talentLevels: Record<string, number>,
  talentDefs: Readonly<Record<string, TalentDef>>,
): number {
  return computeTotalTp(level) - computeSpentTp(talentLevels, talentDefs);
}

export type AllocateFailure =
  | "unknown_talent"
  | "max_level"
  | "insufficient_tp"
  | "prereq_not_met"
  | "not_available";

export type AllocateResult =
  | { ok: true; newLevel: number }
  | { ok: false; reason: AllocateFailure };

/**
 * Try to allocate one talent point into the given talent.
 * Mutates pc.talentLevels on success.
 */
export function allocateTalentPoint(
  pc: PlayerCharacter,
  talentId: TalentId,
  content: ContentDb,
): AllocateResult {
  const def = content.talents[talentId as string];
  if (!def) return { ok: false, reason: "unknown_talent" };

  // Check talent is available to this hero's class.
  const heroCfg = content.starting?.heroes.find(h => h.id === pc.heroConfigId);
  if (heroCfg?.availableTalents && !heroCfg.availableTalents.includes(talentId)) {
    return { ok: false, reason: "not_available" };
  }

  const currentLevel = pc.talentLevels[talentId as string] ?? 0;
  if (currentLevel >= def.maxLevel) return { ok: false, reason: "max_level" };

  // Check TP budget.
  const available = computeAvailableTp(pc.level, pc.talentLevels, content.talents);
  if (available < def.tpCost) return { ok: false, reason: "insufficient_tp" };

  // Check prerequisites.
  if (def.prereqs) {
    for (const prereq of def.prereqs) {
      const prereqLevel = pc.talentLevels[prereq.talentId as string] ?? 0;
      if (prereqLevel < prereq.minLevel) {
        return { ok: false, reason: "prereq_not_met" };
      }
    }
  }

  // Commit.
  const newLevel = currentLevel + 1;
  pc.talentLevels[talentId as string] = newLevel;

  // If the talent was just learned (level 0 → 1), add it to knownTalents
  // so it appears in the runtime talent list.
  if (currentLevel === 0 && def.type === "active") {
    if (!pc.knownTalents.includes(talentId)) {
      pc.knownTalents.push(talentId);
      // Rebuild runtime list.
      pc.knownTalentIds = pc.knownTalents.slice();
    }
  }

  return { ok: true, newLevel };
}

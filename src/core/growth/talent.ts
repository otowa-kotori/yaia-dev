// Talent point allocation.
//
// TP (Talent Points) are derived from character level: totalTp = (level - 1) * 3.
// Players allocate TP into talents to raise their level. Each talent level costs
// tpCost TP. Prerequisites (talent X at level Y) must be met before allocation.
//
// Passive talents: when a passive talent is first learned (0→1) or upgraded,
// the system calls grantEffects(level, owner) to install infinite-duration
// EffectInstances. On upgrade (e.g. 1→2), old instances tagged with the
// talent's sourceTalentId are removed and replaced with new ones. This keeps
// the modifier stack in sync with the talent level.

import type { PlayerCharacter, Character } from "../entity/actor/types";
import type { ContentDb, TalentId, TalentDef, EffectId, AttrDef } from "../content/types";
import type { EffectInstance } from "../infra/state/types";
import { addModifiers, removeModifiersBySource, ATTR, getAttr as getAttrFromSet } from "../entity/attribute";
import { getEffect } from "../content/registry";

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
 * Mutates pc.talentLevels on success. For passive talents, also installs
 * grantEffects as infinite-duration EffectInstances.
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

  // Auto-equip newly learned active/sustain talent if there's a free slot.
  if (currentLevel === 0 && (def.type === "active" || def.type === "sustain")) {
    const maxSlots = getAttrFromSet(pc.attrs, ATTR.TALENT_SLOTS, content.attributes);
    if (pc.equippedTalents.length < maxSlots) {
      if (!pc.equippedTalents.includes(talentId as string)) {
        pc.equippedTalents.push(talentId as string);
      }
    }
  }

  // Passive / sustain talent effect installation.
  // When grantEffects is defined, call it to produce EffectApplications and
  // install them as infinite EffectInstances on the character.
  if (def.grantEffects && (def.type === "passive" || def.type === "sustain")) {
    // Sustain: handle exclusiveGroup — deactivate the old sustain in the same
    // group before installing the new one.
    if (def.type === "sustain" && def.exclusiveGroup) {
      const group = def.exclusiveGroup;
      const oldTalentId = pc.activeSustains[group];
      if (oldTalentId && oldTalentId !== (talentId as string)) {
        removePassiveEffectsForTalent(pc, oldTalentId);
      }
      pc.activeSustains[group] = talentId as string;
    }
    installPassiveEffects(pc, def, newLevel, content.attributes);
  }

  return { ok: true, newLevel };
}

// ---------- Passive effect installation ----------

/**
 * Install (or re-install on upgrade) passive effects from a talent's
 * grantEffects. All installed EffectInstances carry `sourceTalentId` so they
 * can be identified and replaced on level-up.
 *
 * Each EffectApplication produces exactly one EffectInstance. Modifiers are
 * resolved via EffectDef.computeModifiers(state) if present, otherwise
 * EffectDef.modifiers (static). grantEffects returns one application per
 * effect — level scaling is handled inside computeModifiers, not by copy count.
 */
function installPassiveEffects(
  pc: PlayerCharacter,
  def: TalentDef,
  level: number,
  attrDefs: Readonly<Record<string, AttrDef>>,
): void {
  if (!def.grantEffects) return;

  const talentId = def.id as string;

  // Remove old instances from this talent (upgrade path: level N → N+1).
  removePassiveEffectsForTalent(pc, talentId);

  // Call grantEffects to get the new set of EffectApplications.
  const applications = def.grantEffects(level, pc as Character);

  for (let i = 0; i < applications.length; i++) {
    const app = applications[i]!;
    const sourceId = `talent:${talentId}:${app.effectId}:${i}`;
    const state = app.state ?? {};
    const inst: EffectInstance = {
      effectId: app.effectId as string,
      sourceId,
      sourceActorId: pc.id,
      sourceTalentId: talentId,
      remainingActions: -1, // infinite
      stacks: 1,
      state,
    };
    pc.activeEffects.push(inst);

    // Resolve modifiers: computeModifiers(state) takes priority over static modifiers.
    const effDef = safeGetEffect(app.effectId as string);
    if (effDef) {
      const mods = effDef.computeModifiers
        ? effDef.computeModifiers(state)
        : (effDef.modifiers ?? []);
      if (mods.length > 0) {
        addModifiers(pc.attrs, mods.map(m => ({ ...m, sourceId })));
      }
    }
  }
}

/**
 * Remove all passive EffectInstances that were installed by a specific talent.
 * Also removes their modifier contributions from the attr stack.
 */
function removePassiveEffectsForTalent(
  pc: PlayerCharacter,
  talentId: string,
): void {
  const toRemove = pc.activeEffects.filter(ae => ae.sourceTalentId === talentId);
  if (toRemove.length === 0) return;

  for (const ae of toRemove) {
    removeModifiersBySource(pc.attrs, ae.sourceId);
  }
  pc.activeEffects = pc.activeEffects.filter(ae => ae.sourceTalentId !== talentId);
}

function safeGetEffect(id: string) {
  try {
    return getEffect(id);
  } catch {
    return undefined;
  }
}

// ---------- Sustain toggle ----------

export type ToggleSustainResult =
  | { ok: true; activated: boolean }
  | { ok: false; reason: "unknown_talent" | "not_sustain" | "not_learned" };

/**
 * Toggle a sustain talent on or off. If activating, deactivates any other
 * sustain in the same exclusiveGroup first. If deactivating, removes the
 * talent's passive effects.
 */
export function toggleSustain(
  pc: PlayerCharacter,
  talentId: TalentId,
  content: ContentDb,
): ToggleSustainResult {
  const def = content.talents[talentId as string];
  if (!def) return { ok: false, reason: "unknown_talent" };
  if (def.type !== "sustain") return { ok: false, reason: "not_sustain" };

  const level = pc.talentLevels[talentId as string] ?? 0;
  if (level === 0) return { ok: false, reason: "not_learned" };

  const group = def.exclusiveGroup ?? talentId;
  const isCurrentlyActive = pc.activeSustains[group] === (talentId as string);

  if (isCurrentlyActive) {
    // Deactivate.
    removePassiveEffectsForTalent(pc, talentId as string);
    delete pc.activeSustains[group];
    return { ok: true, activated: false };
  }

  // Activate: remove old sustain in same group first.
  const oldTalentId = pc.activeSustains[group];
  if (oldTalentId) {
    removePassiveEffectsForTalent(pc, oldTalentId);
  }
  pc.activeSustains[group] = talentId as string;

  if (def.grantEffects) {
    installPassiveEffects(pc, def, level, content.attributes);
  }
  return { ok: true, activated: true };
}

// ---------- Talent equip / unequip ----------

export type EquipTalentFailure =
  | "unknown_talent"
  | "not_learned"
  | "already_equipped"
  | "no_free_slot"
  | "passive_cannot_equip";

export type EquipTalentResult =
  | { ok: true }
  | { ok: false; reason: EquipTalentFailure };

/**
 * Equip an active or sustain talent into a combat slot.
 * Passive talents cannot be equipped (they are always active).
 * Basic attack is implicitly always available and does not occupy a slot.
 */
export function equipTalent(
  pc: PlayerCharacter,
  talentId: TalentId,
  content: ContentDb,
): EquipTalentResult {
  const def = content.talents[talentId as string];
  if (!def) return { ok: false, reason: "unknown_talent" };
  if (def.type === "passive") return { ok: false, reason: "passive_cannot_equip" };

  const level = pc.talentLevels[talentId as string] ?? 0;
  if (level === 0) return { ok: false, reason: "not_learned" };

  if (pc.equippedTalents.includes(talentId as string)) {
    return { ok: false, reason: "already_equipped" };
  }

  const maxSlots = getAttrFromSet(pc.attrs, ATTR.TALENT_SLOTS, content.attributes);
  if (pc.equippedTalents.length >= maxSlots) {
    return { ok: false, reason: "no_free_slot" };
  }

  pc.equippedTalents.push(talentId as string);

  // If it's a sustain and has grantEffects, install its effects.
  if (def.type === "sustain" && def.grantEffects) {
    // Handle exclusiveGroup — deactivate old sustain in same group.
    if (def.exclusiveGroup) {
      const group = def.exclusiveGroup;
      const oldTalentId = pc.activeSustains[group];
      if (oldTalentId && oldTalentId !== (talentId as string)) {
        removePassiveEffectsForTalent(pc, oldTalentId);
      }
      pc.activeSustains[group] = talentId as string;
    }
    installPassiveEffects(pc, def, level, content.attributes);
  }

  return { ok: true };
}

export type UnequipTalentFailure =
  | "not_equipped";

export type UnequipTalentResult =
  | { ok: true }
  | { ok: false; reason: UnequipTalentFailure };

/**
 * Unequip an active or sustain talent from a combat slot.
 * If it's a sustain, its effects are removed.
 */
export function unequipTalent(
  pc: PlayerCharacter,
  talentId: TalentId,
  content: ContentDb,
): UnequipTalentResult {
  const idx = pc.equippedTalents.indexOf(talentId as string);
  if (idx === -1) return { ok: false, reason: "not_equipped" };

  pc.equippedTalents.splice(idx, 1);

  // If it was a sustain, remove its effects and deactivate.
  const def = content.talents[talentId as string];
  if (def?.type === "sustain") {
    removePassiveEffectsForTalent(pc, talentId as string);
    if (def.exclusiveGroup) {
      const group = def.exclusiveGroup;
      if (pc.activeSustains[group] === (talentId as string)) {
        delete pc.activeSustains[group];
      }
    }
  }

  return { ok: true };
}

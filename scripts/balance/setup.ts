// Hero setup: configure a PlayerCharacter through the GameSession API.
//
// All mutations go through session / CharacterController methods so the full
// game-logic chain (rebuildCharacterDerived, modifier stacking, talent
// validation, etc.) executes exactly as in-game.

import type { ContentDb } from "../../src/core/content";
import type { GameSession, CharacterController } from "../../src/core/session";
import type { HeroProfile } from "./config";
import { getContent } from "../../src/core/content/registry";

// ---------- Public API ----------

/**
 * Configure one hero to match a HeroProfile.
 *
 * Precondition: session.resetToFresh() has already been called, so all
 * starting heroes exist at level 1 with their starting equipment.
 */
export function setupHero(
  session: GameSession,
  profile: HeroProfile,
): void {
  const heroId = profile.heroId;
  const cc = session.getCharacter(heroId);

  // 1) Level up, then lock maxLevel so combat XP can't cause mid-sim upgrades.
  const targetLevel = profile.level ?? 1;
  if (targetLevel > 1) {
    session.debugGrantHeroLevels(heroId, targetLevel - 1);
  }
  cc.hero.maxLevel = targetLevel;
  cc.hero.exp = 0;

  // 2) Give & equip items.
  for (const itemId of profile.equipment ?? []) {
    session.debugGiveItem(heroId, itemId, 1);
    // Find the newly added item in inventory and equip it.
    const slotIndex = findGearSlot(session, heroId, itemId);
    if (slotIndex !== -1) {
      cc.equipItem(slotIndex);
    }
  }

  // 3) Allocate talent points.
  for (const [talentId, targetLevel] of Object.entries(profile.talents ?? {})) {
    const currentLevel = cc.hero.talentLevels[talentId] ?? 0;
    const pointsNeeded = targetLevel - currentLevel;
    for (let i = 0; i < pointsNeeded; i++) {
      cc.allocateTalent(talentId);
    }
  }

  // 4) Equip specific talents into battle slots.
  //    allocateTalent may auto-equip, so first unequip all non-basic talents
  //    to get a clean slate, then equip the requested ones.
  for (const talentId of profile.equippedTalents ?? []) {
    // Only equip if not already equipped (allocateTalent may have auto-equipped).
    if (!cc.hero.equippedTalents.includes(talentId as any)) {
      cc.equipTalent(talentId);
    }
  }
}

// ---------- Location lookup ----------

/**
 * Find the locationId that contains a given combatZoneId.
 * Scans content.locations entries. Throws if not found.
 */
export function findLocationForCombatZone(
  combatZoneId: string,
  content: ContentDb,
): string {
  for (const loc of Object.values(content.locations)) {
    for (const entry of loc.entries) {
      if (entry.kind === "combat" && entry.combatZoneId === combatZoneId) {
        return loc.id;
      }
    }
  }
  throw new Error(
    `findLocationForCombatZone: no location found containing combatZoneId "${combatZoneId}"`,
  );
}

// ---------- Internal helpers ----------

/**
 * Find the inventory slot index of a gear item with the given itemId.
 * Searches from the end since debugGiveItem appends to the first free slot,
 * and we want the most recently added one (in case of duplicates).
 */
function findGearSlot(
  session: GameSession,
  heroId: string,
  itemId: string,
): number {
  const inv = session.state.inventories[heroId];
  if (!inv) return -1;
  // Search from end to find the most recently added gear instance.
  for (let i = inv.slots.length - 1; i >= 0; i--) {
    const slot = inv.slots[i];
    if (!slot) continue;
    if (slot.kind === "gear" && slot.instance.itemId === itemId) return i;
    if (slot.kind === "stack" && slot.itemId === itemId) return i;
  }
  return -1;
}

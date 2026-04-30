// Content registry: single source of truth for all static game data.
//
// The registry is MUTABLE at module level so content can be hot-replaced
// in dev. Callers should NOT cache references into the returned ContentDb —
// always go through getContent().

import { emptyContentDb, type ContentDb } from "./types";

let current: ContentDb = emptyContentDb();

/** Overwrite the entire content db. Safe to call at any time in dev; in prod
 * this should run exactly once at boot. */
export function setContent(db: ContentDb): void {
  current = db;
}

/** Merge a partial content db on top of the current one. Dev convenience. */
export function patchContent(partial: Partial<ContentDb>): void {
  current = {
    items: { ...current.items, ...(partial.items ?? {}) },
    monsters: { ...current.monsters, ...(partial.monsters ?? {}) },
    effects: { ...current.effects, ...(partial.effects ?? {}) },
    skills: { ...current.skills, ...(partial.skills ?? {}) },
    locations: { ...current.locations, ...(partial.locations ?? {}) },
    combatZones: { ...current.combatZones, ...(partial.combatZones ?? {}) },
    dungeons: { ...current.dungeons, ...(partial.dungeons ?? {}) },
    recipes: { ...current.recipes, ...(partial.recipes ?? {}) },
    talents: { ...current.talents, ...(partial.talents ?? {}) },
    upgrades: { ...current.upgrades, ...(partial.upgrades ?? {}) },
    attributes: { ...current.attributes, ...(partial.attributes ?? {}) },
    resourceNodes: {
      ...current.resourceNodes,
      ...(partial.resourceNodes ?? {}),
    },
    unlocks: { ...current.unlocks, ...(partial.unlocks ?? {}) },
    npcs: { ...current.npcs, ...(partial.npcs ?? {}) },
    dialogues: { ...current.dialogues, ...(partial.dialogues ?? {}) },
    formulas: { ...current.formulas, ...(partial.formulas ?? {}) },
    starting: partial.starting ?? current.starting,
  };
}

export function getContent(): ContentDb {
  return current;
}

// Typed lookup helpers that throw on missing. Use these everywhere instead
// of indexing into the db, so typos and bad IDs surface loudly.

export function getItem(id: string) {
  const v = current.items[id];
  if (!v) throw new Error(`content: no item "${id}"`);
  return v;
}
export function getMonster(id: string) {
  const v = current.monsters[id];
  if (!v) throw new Error(`content: no monster "${id}"`);
  return v;
}
export function getEffect(id: string) {
  const v = current.effects[id];
  if (!v) throw new Error(`content: no effect "${id}"`);
  return v;
}
export function getSkill(id: string) {
  const v = current.skills[id];
  if (!v) throw new Error(`content: no skill "${id}"`);
  return v;
}
export function getLocation(id: string) {
  const v = current.locations[id];
  if (!v) throw new Error(`content: no location "${id}"`);
  return v;
}
export function getCombatZone(id: string) {
  const v = current.combatZones[id];
  if (!v) throw new Error(`content: no combatZone "${id}"`);
  return v;
}
export function getDungeon(id: string) {
  const v = current.dungeons[id];
  if (!v) throw new Error(`content: no dungeon "${id}"`);
  return v;
}
export function getRecipe(id: string) {
  const v = current.recipes[id];
  if (!v) throw new Error(`content: no recipe "${id}"`);
  return v;
}
export function getTalent(id: string) {
  const v = current.talents[id];
  if (!v) throw new Error(`content: no talent "${id}"`);
  return v;
}
export function getAttr(id: string) {
  const v = current.attributes[id];
  if (!v) throw new Error(`content: no attribute "${id}"`);
  return v;
}
export function getResourceNode(id: string) {
  const v = current.resourceNodes[id];
  if (!v) throw new Error(`content: no resourceNode "${id}"`);
  return v;
}
export function getFormula(id: string) {
  const v = current.formulas[id];
  if (!v) throw new Error(`content: no formula "${id}"`);
  return v;
}
export function getUnlock(id: string) {
  const v = current.unlocks[id];
  if (!v) throw new Error(`content: no unlock "${id}"`);
  return v;
}
export function hasUnlock(id: string): boolean {
  return !!current.unlocks[id];
}
export function getNpc(id: string) {
  const v = current.npcs[id];
  if (!v) throw new Error(`content: no npc "${id}"`);
  return v;
}
export function getDialogue(id: string) {
  const v = current.dialogues[id];
  if (!v) throw new Error(`content: no dialogue "${id}"`);
  return v;
}

/** Reset to empty — tests only. */
export function resetContent(): void {
  current = emptyContentDb();
}

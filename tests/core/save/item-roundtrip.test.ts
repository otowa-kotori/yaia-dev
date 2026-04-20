import { describe, test, expect, beforeEach } from "bun:test";
import { deserialize, serialize } from "../../../src/core/save";
import { createEmptyState } from "../../../src/core/state";
import { resetContent, patchContent } from "../../../src/core/content";
import type { ItemDef, ItemId } from "../../../src/core/content/types";
import { ATTR } from "../../../src/core/attribute";
import { isPlayer, getAttr } from "../../../src/core/actor";
import {
  addGear,
  addStack,
  createInventory,
  DEFAULT_CHAR_INVENTORY_CAPACITY,
} from "../../../src/core/inventory";
import { createGearInstance } from "../../../src/core/item";
import { createRng } from "../../../src/core/rng";
import { attrDefs, loadFixtureContent, makePlayer } from "../../fixtures/content";

// A content bundle the save layer needs to resolve itemIds / slots.
const copperOre: ItemDef = {
  id: "item.ore.copper_save_test" as ItemId,
  name: "Copper Ore",
  stackable: true,
};

const moddedSword: ItemDef = {
  id: "item.weapon.roundtrip_sword" as ItemId,
  name: "Roundtrip Sword",
  stackable: false,
  slot: "weapon",
  modifiers: [{ stat: ATTR.ATK, op: "flat", value: 5, sourceId: "" }],
  roll: {
    mods: [{ stat: ATTR.ATK, op: "flat", min: 1, max: 1 }], // pin to +1 for determinism
  },
};

describe("inventory + gear save roundtrip", () => {
  beforeEach(() => {
    resetContent();
    loadFixtureContent();
    patchContent({
      items: {
        [copperOre.id]: copperOre,
        [moddedSword.id]: moddedSword,
      },
    });
  });

  test("stacks and gear survive serialize/deserialize", () => {
    const state = createEmptyState(7, 1);
    const hero = makePlayer({ id: "hero.1", abilities: [], atk: 10, maxHp: 100 });
    state.actors.push(hero);
    state.inventories[hero.id] = createInventory(DEFAULT_CHAR_INVENTORY_CAPACITY);

    // Stack + two gear instances occupying distinct slots.
    addStack(state.inventories[hero.id]!, copperOre.id, 7);
    const rng = createRng(123);
    const s1 = createGearInstance(moddedSword.id, { rng });
    const s2 = createGearInstance(moddedSword.id, { rng });
    addGear(state.inventories[hero.id]!, s1);
    addGear(state.inventories[hero.id]!, s2);

    const restored = deserialize(serialize(state), { attrDefs });
    const restoredInv = restored.inventories[hero.id]!;
    expect(restoredInv.capacity).toBe(DEFAULT_CHAR_INVENTORY_CAPACITY);

    const ore = restoredInv.slots[0];
    expect(ore).toEqual({ kind: "stack", itemId: copperOre.id, qty: 7 });

    const g1 = restoredInv.slots[1];
    const g2 = restoredInv.slots[2];
    if (!g1 || g1.kind !== "gear") throw new Error("slot 1 should be gear");
    if (!g2 || g2.kind !== "gear") throw new Error("slot 2 should be gear");
    expect(g1.instance.instanceId).toBe(s1.instanceId);
    expect(g2.instance.instanceId).toBe(s2.instanceId);
    expect(g1.instance.itemId).toBe(moddedSword.id);
  });

  test("equipped GearInstance survives roundtrip and rebuilds attrs", () => {
    const state = createEmptyState(9, 1);
    const hero = makePlayer({ id: "hero.1", abilities: [], atk: 10, maxHp: 100 });
    const sword = createGearInstance(moddedSword.id, { rng: createRng(1) });
    hero.equipped = { weapon: sword };
    state.actors.push(hero);
    state.inventories[hero.id] = createInventory(DEFAULT_CHAR_INVENTORY_CAPACITY);

    const restored = deserialize(serialize(state), { attrDefs });
    const loaded = restored.actors[0]!;
    if (!isPlayer(loaded)) throw new Error("expected player");
    expect(loaded.equipped.weapon?.instanceId).toBe(sword.instanceId);
    // +5 from def.modifiers, +1 from pinned roll (min==max==1) → +6 over base 10.
    expect(getAttr(loaded, ATTR.ATK, attrDefs)).toBe(16);
  });
});

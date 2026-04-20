import { describe, test, expect } from "bun:test";
import type { ItemId } from "../../../src/core/content/types";
import type { GearInstance } from "../../../src/core/item";
import {
  addGear,
  addStack,
  countItem,
  createInventory,
  findStackSlot,
  removeAtSlot,
} from "../../../src/core/inventory";

const ORE = "item.ore.copper" as ItemId;
const SWORD = "item.weapon.copper_sword" as ItemId;

function gear(instanceId: string, itemId: ItemId = SWORD): GearInstance {
  return { instanceId, itemId, rolledMods: [] };
}

describe("inventory ops", () => {
  test("createInventory builds a capacity-sized array of nulls", () => {
    const inv = createInventory(5);
    expect(inv.capacity).toBe(5);
    expect(inv.slots.length).toBe(5);
    expect(inv.slots.every((s) => s === null)).toBe(true);
  });

  test("addStack merges into existing stack of same itemId", () => {
    const inv = createInventory(3);
    addStack(inv, ORE, 2);
    addStack(inv, ORE, 5);
    expect(inv.slots[0]).toEqual({ kind: "stack", itemId: ORE, qty: 7 });
    expect(inv.slots[1]).toBeNull();
  });

  test("addStack claims first empty slot when item not present", () => {
    const inv = createInventory(3);
    addGear(inv, gear("g1"));
    addStack(inv, ORE, 2);
    expect(inv.slots[0]?.kind).toBe("gear");
    expect(inv.slots[1]).toEqual({ kind: "stack", itemId: ORE, qty: 2 });
  });

  test("addGear always occupies a fresh slot (never stacks)", () => {
    const inv = createInventory(3);
    addGear(inv, gear("g1"));
    addGear(inv, gear("g2"));
    expect(inv.slots[0]?.kind).toBe("gear");
    expect(inv.slots[1]?.kind).toBe("gear");
    expect(
      (inv.slots[0] as { instance: GearInstance }).instance.instanceId,
    ).not.toBe(
      (inv.slots[1] as { instance: GearInstance }).instance.instanceId,
    );
  });

  test("stacks and gear coexist in the same bag", () => {
    const inv = createInventory(4);
    addStack(inv, ORE, 50);
    addGear(inv, gear("g1"));
    addGear(inv, gear("g2"));
    expect(inv.slots[0]?.kind).toBe("stack");
    expect(inv.slots[1]?.kind).toBe("gear");
    expect(inv.slots[2]?.kind).toBe("gear");
    expect(inv.slots[3]).toBeNull();
  });

  test("addStack throws when bag is full and item is not present", () => {
    const inv = createInventory(2);
    addGear(inv, gear("g1"));
    addGear(inv, gear("g2"));
    expect(() => addStack(inv, ORE, 1)).toThrow(/full/);
  });

  test("addStack still merges even when all other slots are full", () => {
    const inv = createInventory(2);
    addStack(inv, ORE, 1);
    addGear(inv, gear("g1"));
    // Bag is 'full' by slot count, but merging into the existing ore stack is fine.
    expect(() => addStack(inv, ORE, 10)).not.toThrow();
    expect((inv.slots[0] as { qty: number }).qty).toBe(11);
  });

  test("addGear throws when bag is full", () => {
    const inv = createInventory(1);
    addGear(inv, gear("g1"));
    expect(() => addGear(inv, gear("g2"))).toThrow(/full/);
  });

  test("findStackSlot + countItem ignore gear", () => {
    const inv = createInventory(3);
    addStack(inv, ORE, 4);
    addGear(inv, gear("g1", ORE)); // even with matching itemId, gear is a different class
    expect(findStackSlot(inv, ORE)).toBe(0);
    expect(countItem(inv, ORE)).toBe(4);
  });

  test("removeAtSlot: stack partial removal leaves residue", () => {
    const inv = createInventory(2);
    addStack(inv, ORE, 10);
    const out = removeAtSlot(inv, 0, 3);
    expect(out).toEqual({ kind: "stack", itemId: ORE, qty: 3 });
    expect(inv.slots[0]).toEqual({ kind: "stack", itemId: ORE, qty: 7 });
  });

  test("removeAtSlot: stack full removal nulls slot", () => {
    const inv = createInventory(2);
    addStack(inv, ORE, 5);
    removeAtSlot(inv, 0);
    expect(inv.slots[0]).toBeNull();
  });

  test("removeAtSlot: gear pops whole instance, nulls slot", () => {
    const inv = createInventory(2);
    addGear(inv, gear("g1"));
    const out = removeAtSlot(inv, 0);
    expect(out.kind).toBe("gear");
    expect(inv.slots[0]).toBeNull();
  });

  test("removeAtSlot: empty slot or bad index throws", () => {
    const inv = createInventory(2);
    expect(() => removeAtSlot(inv, 0)).toThrow(/empty/);
    expect(() => removeAtSlot(inv, 5)).toThrow(/range/);
  });
});

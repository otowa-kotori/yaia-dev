// Inventory operations.
//
// All helpers mutate the passed Inventory in place. Out-of-space conditions
// throw — this follows the alpha "no silent fallback" policy. Callers that
// want softer behaviour (drop on ground, mailbox) wrap the throw themselves.
//
// Stack merging:
//   addStack first fills every existing StackEntry with the same itemId, then
//   allocates fresh slots for any overflow.
//   stackLimit = null means unlimited stacking (current shared-bag behaviour).
//   stackLimit = N means each slot can hold at most N copies of that item.
//
// Gear placement:
//   addGear always takes the lowest-index null slot. No stacking possible
//   (every GearInstance is unique).
//
// removeAtSlot:
//   For stacks: decrements qty by `qty` (default: entire stack). When qty
//   drops to ≤ 0, the slot is nulled out. Returns the removed StackEntry
//   (with the qty actually removed) for the caller to consume.
//   For gear: qty is ignored; the GearEntry is popped wholesale and returned.

import type { ItemId } from "../content/types";
import type { GearInstance } from "../item/types";
import type { Inventory, InventorySlot, StackEntry } from "./types";

export function createInventory(capacity: number): Inventory {
  if (capacity < 0 || !Number.isFinite(capacity)) {
    throw new Error(`createInventory: invalid capacity ${capacity}`);
  }
  return {
    capacity,
    slots: new Array(capacity).fill(null) as InventorySlot[],
  };
}

/**
 * Merge into existing stacks of the same itemId, then occupy fresh slots for
 * overflow. Throws if the bag runs out of empty slots.
 */
export function addStack(
  inv: Inventory,
  itemId: ItemId | string,
  qty: number,
  stackLimit?: StackLimit,
): void {
  if (qty <= 0) throw new Error(`addStack: qty must be positive, got ${qty}`);

  const normalizedLimit = normalizeStackLimit(stackLimit);
  const resolvedItemId = itemId as ItemId;

  if (normalizedLimit === null) {
    const existingIndex = findStackSlot(inv, itemId);
    if (existingIndex !== -1) {
      const slot = inv.slots[existingIndex] as StackEntry;
      slot.qty += qty;
      return;
    }
    const emptyIndex = firstEmpty(inv);
    if (emptyIndex === -1) {
      throw new Error(`inventory: full (capacity=${inv.capacity}, adding stack "${itemId}")`);
    }
    inv.slots[emptyIndex] = { kind: "stack", itemId: resolvedItemId, qty };
    return;
  }

  let remaining = qty;

  for (const slot of inv.slots) {
    if (!slot || slot.kind !== "stack" || slot.itemId !== itemId) continue;
    const room = normalizedLimit - slot.qty;
    if (room <= 0) continue;
    const added = Math.min(room, remaining);
    slot.qty += added;
    remaining -= added;
    if (remaining === 0) return;
  }

  while (remaining > 0) {
    const emptyIndex = firstEmpty(inv);
    if (emptyIndex === -1) {
      throw new Error(
        `inventory: full (capacity=${inv.capacity}, adding stack "${itemId}", remaining=${remaining})`,
      );
    }
    const added = Math.min(normalizedLimit, remaining);
    inv.slots[emptyIndex] = { kind: "stack", itemId: resolvedItemId, qty: added };
    remaining -= added;
  }
}

function normalizeStackLimit(limit: StackLimit): number | null {
  if (limit === undefined || limit === null) return null;
  if (!Number.isInteger(limit) || limit <= 0) {
    throw new Error(`addStack: invalid stackLimit ${limit}`);
  }
  return limit;
}

/** Occupy the first empty slot with this gear instance. Throws if full. */
export function addGear(inv: Inventory, gear: GearInstance): void {
  const emptyIndex = firstEmpty(inv);
  if (emptyIndex === -1) {
    throw new Error(
      `inventory: full (capacity=${inv.capacity}, adding gear "${gear.itemId}" #${gear.instanceId})`,
    );
  }
  inv.slots[emptyIndex] = { kind: "gear", instance: gear };
}

/** Return the lowest-index slot that holds a stack of itemId, or -1. */
export function findStackSlot(inv: Inventory, itemId: ItemId | string): number {
  for (let i = 0; i < inv.slots.length; i++) {
    const s = inv.slots[i];
    if (s && s.kind === "stack" && s.itemId === itemId) return i;
  }
  return -1;
}

/** Sum qty across every stack matching itemId (gear never counts). */
export function countItem(inv: Inventory, itemId: ItemId | string): number {
  let total = 0;
  for (const s of inv.slots) {
    if (s && s.kind === "stack" && s.itemId === itemId) total += s.qty;
  }
  return total;
}

/**
 * Pop content from a specific slot.
 *   - Stack: decrement qty by `qty` (default: remove whole stack). When the
 *     slot empties, it becomes null. Returns a StackEntry describing the
 *     amount removed (never touches the leftover stack still on the slot).
 *   - Gear: qty is ignored; the GearEntry is removed wholesale.
 *   - Empty slot: throws (callers should check before popping).
 */
export function removeAtSlot(
  inv: Inventory,
  slotIndex: number,
  qty?: number,
): StackEntry | { kind: "gear"; instance: GearInstance } {
  if (slotIndex < 0 || slotIndex >= inv.slots.length) {
    throw new Error(`removeAtSlot: index ${slotIndex} out of range`);
  }
  const slot = inv.slots[slotIndex];
  if (!slot) throw new Error(`removeAtSlot: slot ${slotIndex} is empty`);

  if (slot.kind === "gear") {
    inv.slots[slotIndex] = null;
    return slot;
  }

  // Stack path
  const take = qty ?? slot.qty;
  if (take <= 0) throw new Error(`removeAtSlot: qty must be positive, got ${take}`);
  if (take > slot.qty) {
    throw new Error(
      `removeAtSlot: requested ${take} but slot has ${slot.qty} of "${slot.itemId}"`,
    );
  }
  slot.qty -= take;
  const removed: StackEntry = { kind: "stack", itemId: slot.itemId, qty: take };
  if (slot.qty === 0) inv.slots[slotIndex] = null;
  return removed;
}

/** Index of the first null slot, or -1 if full. */
function firstEmpty(inv: Inventory): number {
  for (let i = 0; i < inv.slots.length; i++) {
    if (inv.slots[i] === null) return i;
  }
  return -1;
}

// Inventory data model.
//
// Fixed-position grid: Inventory.slots is a dense array of length === capacity.
// Empty positions are literal `null`. This keeps slot indices stable across
// mutations (important for future drag/drop UI: slot 0 stays slot 0 even if
// earlier entries are removed).
//
// Each slot can independently be a stack of fungible items (StackEntry) or a
// single unique gear instance (GearEntry). Mixed placement is allowed and
// intentional — slots[0] may hold copper ore ×50 while slots[1] holds a rolled
// copper sword. The kind discriminator makes this safe: never inspect `qty` to
// decide item class.
//
// Plain data. Rides GameState through save/load with no special handling.

import type { ItemId } from "../content/types";
import type { GearInstance } from "../item/types";

export interface StackEntry {
  kind: "stack";
  itemId: ItemId;
  qty: number;
}

export interface GearEntry {
  kind: "gear";
  instance: GearInstance;
}

export type InventorySlot = StackEntry | GearEntry | null;

export interface Inventory {
  capacity: number;
  slots: InventorySlot[]; // length === capacity, null = empty slot
}

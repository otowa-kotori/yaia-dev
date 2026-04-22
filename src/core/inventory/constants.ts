// Default inventory capacities.
//
// Numbers are intentionally round; the inventory is alpha-grade and capacity
// balance has not been tuned. Raise later if players complain; lower if we
// want to force a "weight" pressure.

export const DEFAULT_CHAR_INVENTORY_CAPACITY = 20;
export const DEFAULT_SHARED_INVENTORY_CAPACITY = 40;

// Per-slot stack caps are sourced from the inventory owner / state, not stored
// on the Inventory itself. `null` means unlimited stacking for that bag.
export const DEFAULT_CHAR_STACK_LIMIT = 1;  // TEMP: was 50, set to 1 to test pending loot
export const DEFAULT_SHARED_STACK_LIMIT: number | null = null;

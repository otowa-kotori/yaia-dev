// Non-stackable item instances ("gear").
//
// Two classes of items live in the game:
//   - Stackable items: only { itemId, qty } matters. No per-copy state.
//     Stored directly in inventory slots as StackEntry.
//   - Non-stackable items (gear / equipment): every copy is unique. It carries
//     a stable instanceId and a rolled set of modifiers on top of whatever
//     ItemDef.modifiers baseline says. Stored as GearEntry.
//
// We deliberately keep GearInstance as a standalone interface rather than
// flattening into slot/equipped records so future extensions (refine level,
// socket gems, customName, soulbound, bornAtTick, …) don't ripple through
// every call site. Add fields here; downstream just preserves them via JSON.
//
// Rules:
//   - Plain data, JSON-safe. GearInstance rides GameState straight through
//     serialize/deserialize with no extra hooks.
//   - instanceId is assigned at creation and NEVER reused. Two gear copies
//     with the same itemId must have different instanceIds.
//   - rolledMods are source-of-truth; rebuildCharacterDerived concatenates
//     ItemDef.modifiers (baseline) + rolledMods (per-instance).
//   - All gear is born via createGearInstance (see ./factory.ts). No ad-hoc
//     literals in production code paths.

import type { Modifier } from "../content/types";
import type { ItemId } from "../content/types";

export interface GearInstance {
  /** Globally unique. Assigned at creation. */
  instanceId: string;
  /** Points at ItemDef in the content registry (name / slot / baseline mods live there). */
  itemId: ItemId;
  /** Per-instance random affixes rolled at creation. */
  rolledMods: Modifier[];
  // Room to grow: refineLevel?: number; sockets?: GemInstance[];
  // customName?: string; soulbound?: boolean; bornAtTick?: number; ...
}

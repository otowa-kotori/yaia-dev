// Gear instance factory.
//
// The ONLY sanctioned path for creating a GearInstance in gameplay code. Used
// by loot drops, crafting outputs, dev tools and test fixtures alike. All
// randomness flows through ctx.rng — no Math.random().
//
// Behaviour:
//   - Looks up ItemDef via the content registry. Missing id → throw (alpha
//     policy: surface bad content loudly).
//   - Refuses to instantiate a stackable item. Those don't have per-copy
//     state; a caller asking for one is a bug.
//   - If ItemDef.roll is present, produces one Modifier per entry in rollSpec
//     using an inclusive [min, max] range. Integer affixes default to true.
//   - instanceId is derived from rng so save-state determinism holds: replay
//     the same rng stream and you get the same ids.

import { getItem } from "../content/registry";
import type { ItemId, Modifier } from "../content/types";
import type { Rng } from "../rng";
import type { GearInstance } from "./types";

export interface CreateGearCtx {
  rng: Rng;
}

export function createGearInstance(
  itemId: ItemId | string,
  ctx: CreateGearCtx,
): GearInstance {
  const def = getItem(itemId);
  if (def.stackable) {
    throw new Error(
      `createGearInstance: "${itemId}" is stackable; use addStack instead`,
    );
  }

  const rolledMods: Modifier[] = [];
  if (def.roll?.mods.length) {
    for (const spec of def.roll.mods) {
      const integer = spec.integer ?? true;
      // Rolling inclusive range [min, max]. int() handles integer case; for
      // non-integer we do the same span arithmetic with the float stream.
      let value: number;
      if (integer) {
        value = ctx.rng.int(spec.min, spec.max);
      } else {
        value = spec.min + ctx.rng.next() * (spec.max - spec.min);
      }
      rolledMods.push({
        stat: spec.stat,
        op: spec.op,
        value,
        // sourceId gets rewritten to an equip-scoped one in rebuildCharacterDerived.
        // We still stamp something meaningful here so bare inspection is readable.
        sourceId: "gear.roll",
      });
    }
  }

  return {
    instanceId: mintInstanceId(ctx.rng),
    itemId: itemId as ItemId,
    rolledMods,
  };
}

/** Short deterministic id derived from the rng stream. */
function mintInstanceId(rng: Rng): string {
  // Two 32-bit pulls → 8 base36 chars. Good enough to dodge per-save collisions;
  // if we ever need world-unique ids across shards we'll pivot to uuid.
  const a = Math.floor(rng.next() * 4294967296).toString(36);
  const b = Math.floor(rng.next() * 4294967296).toString(36);
  return `gear.${a}${b}`;
}

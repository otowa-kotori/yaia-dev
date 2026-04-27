// PendingLootPanel — pending loot grid for overflow items.
//
// Shows items that overflowed from the hero's inventory during combat or
// gathering. The player can pick up individual items or use "pick up all".

import type { PendingLootEntry } from "../../core/world/stage/types";
import type { CharacterController } from "../../core/session";
import { ItemSlotCell, safeItemName, slotGridStyle } from "./ItemSlot";
import { T } from "../text";

export function PendingLootPanel({
  cc,
  pendingLoot,
}: {
  cc: CharacterController;
  pendingLoot: PendingLootEntry[];
}) {
  if (pendingLoot.length === 0) return null;

  return (
    <div className="p-2.5 bg-surface rounded-lg border border-gold/40 mb-3">
      <div className="flex justify-between items-center font-semibold mb-2 text-[13px]">
        <span className="text-gold">
          {T.pendingLoot} ({pendingLoot.length})
        </span>
        <button
          type="button"
          onClick={() => cc.pickUpAllPendingLoot()}
          className="px-2.5 py-1 rounded border border-gold/40 bg-yellow-900/20 text-gold text-[11px] cursor-pointer hover:bg-yellow-900/30"
        >
          {T.btn_pickUpAll}
        </button>
      </div>
      <div className="text-[11px] text-gray-500 mb-2 leading-relaxed">
        {T.pendingLootHint}
      </div>
      <div className="grid gap-1" style={slotGridStyle()}>
        {pendingLoot.map((entry, i) => {
          const itemId = entry.kind === "stack" ? entry.itemId : entry.instance.itemId;
          const name = safeItemName(itemId);
          const qty = entry.kind === "stack" ? ` \u00d7${entry.qty}` : "";
          return (
            <ItemSlotCell
              key={i}
              item={entry}
              onClick={() => cc.pickUpPendingLoot(i)}
              tooltip={`${name}${qty}`}
            />
          );
        })}
      </div>
    </div>
  );
}

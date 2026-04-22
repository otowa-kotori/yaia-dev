// Pending loot grid panel — shared between Map tab and Inventory tab.
//
// Shows items that overflowed from the hero's inventory during combat or
// gathering. Renders them in the same grid-cell format as the bag. The player
// can pick up individual items or use "pick up all".

import type { PendingLootEntry } from "../core/stage/types";
import type { CharacterController } from "../core/session";
import { ItemSlotCell, safeItemName, CELL_SIZE, CELL_GAP, GRID_COLS } from "./ItemSlot";
import { T } from "./text";

export function PendingLootPanel({
  cc,
  pendingLoot,
}: {
  cc: CharacterController;
  pendingLoot: PendingLootEntry[];
}) {
  if (pendingLoot.length === 0) return null;

  const cols = GRID_COLS;
  const rows = Math.ceil(pendingLoot.length / cols);
  const gridWidth = cols * CELL_SIZE + (cols - 1) * CELL_GAP;

  function handlePickUp(index: number): void {
    cc.pickUpPendingLoot(index);
  }

  function handlePickUpAll(): void {
    cc.pickUpAllPendingLoot();
  }

  return (
    <div style={panelStyle}>
      <div style={headerStyle}>
        <span style={{ color: "#f0c674" }}>
          {T.pendingLoot} ({pendingLoot.length})
        </span>
        <button onClick={handlePickUpAll} style={pickUpAllBtnStyle}>
          {T.btn_pickUpAll}
        </button>
      </div>
      <div style={{ fontSize: 11, opacity: 0.6, marginBottom: 8, lineHeight: 1.5 }}>
        {T.pendingLootHint}
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: `repeat(${cols}, ${CELL_SIZE}px)`,
          gridTemplateRows: `repeat(${rows}, ${CELL_SIZE}px)`,
          gap: CELL_GAP,
          width: gridWidth,
          overflow: "hidden",
        }}
      >
        {pendingLoot.map((entry, i) => {
          const itemId = entry.kind === "stack" ? entry.itemId : entry.instance.itemId;
          const name = safeItemName(itemId);
          const qty = entry.kind === "stack" ? ` ×${entry.qty}` : "";
          return (
            <ItemSlotCell
              key={i}
              item={entry}
              onClick={() => handlePickUp(i)}
              tooltip={`${name}${qty}`}
            />
          );
        })}
      </div>
    </div>
  );
}

// ---------- Styles ----------

const panelStyle: React.CSSProperties = {
  padding: 10,
  background: "#222",
  borderRadius: 4,
  border: "1px solid #8a6d3b",
};

const headerStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  fontWeight: 600,
  marginBottom: 8,
  fontSize: 13,
};

const pickUpAllBtnStyle: React.CSSProperties = {
  padding: "4px 10px",
  borderRadius: 4,
  border: "1px solid #8a6d3b",
  background: "#2a2418",
  color: "#f0c674",
  cursor: "pointer",
  fontFamily: "inherit",
  fontSize: 11,
};

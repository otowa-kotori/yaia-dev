// Reusable item slot cell — used by BagGrid (inventory) and PendingLootPanel.
//
// Renders a single square cell showing an item abbreviation + qty/affix badge.
// Accepts a unified "display item" shape so it can render both InventorySlot
// and PendingLootEntry data without knowing the source.

import { useState } from "react";
import { getContent } from "../core/content";
import type { GearEntry, StackEntry } from "../core/inventory";
import type { PendingLootEntry } from "../core/world/stage/types";

// ---------- Layout constants (shared with grids) ----------

export const CELL_SIZE = 52;
export const CELL_GAP = 4;
export const GRID_COLS = 5;

// ---------- Helpers (exported for tooltip / details) ----------

export function safeItemName(itemId: string): string {
  const def = getContent().items[itemId];
  return def?.name ?? itemId;
}

export function itemAbbr(name: string): string {
  const words = name.split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) {
    const word = words[0]!;
    return word.length <= 3 ? word : word.slice(0, 2);
  }
  return (words[0]![0]! + words[1]![0]!).toUpperCase();
}

// ---------- ItemSlotCell ----------

export interface ItemSlotCellProps {
  /** null = empty slot. */
  item: StackEntry | GearEntry | PendingLootEntry | null;
  selected?: boolean;
  onClick?: () => void;
  tooltip?: string;
}

export function ItemSlotCell({ item, selected = false, onClick, tooltip }: ItemSlotCellProps) {
  const [hovered, setHovered] = useState(false);
  const clickable = item !== null && onClick !== undefined;

  const base: React.CSSProperties = {
    width: CELL_SIZE,
    height: CELL_SIZE,
    boxSizing: "border-box",
    border: `1px solid ${selected ? "#4a9" : item === null ? "#2a2a2a" : "#444"}`,
    boxShadow: selected ? "0 0 0 1px #4a9 inset" : undefined,
    borderRadius: 3,
    background: item === null ? "#191919" : hovered || selected ? "#2e2e2e" : "#242424",
    position: "relative",
    cursor: clickable ? "pointer" : "default",
    transition: "background 80ms, border-color 80ms",
    overflow: "hidden",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    userSelect: "none",
  };

  return (
    <div
      style={base}
      title={tooltip}
      onClick={clickable ? onClick : undefined}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {item?.kind === "stack" && <StackCellContent itemId={item.itemId} qty={item.qty} lit={hovered || selected} />}
      {item?.kind === "gear" && (
        <GearCellContent itemId={item.instance.itemId} affixCount={item.instance.rolledMods.length} lit={hovered || selected} />
      )}
    </div>
  );
}

// ---------- Cell content ----------

function StackCellContent({ itemId, qty, lit }: { itemId: string; qty: number; lit: boolean }) {
  const abbr = itemAbbr(safeItemName(itemId));
  return (
    <>
      <span style={{ fontSize: 13, fontWeight: 600, color: "#9cb", opacity: lit ? 1 : 0.9 }}>
        {abbr}
      </span>
      <span
        style={{
          position: "absolute",
          bottom: 2,
          right: 3,
          fontSize: 10,
          fontVariantNumeric: "tabular-nums",
          opacity: 0.8,
          color: "#ccc",
          lineHeight: 1,
        }}
      >
        {qty}
      </span>
    </>
  );
}

function GearCellContent({ itemId, affixCount, lit }: { itemId: string; affixCount: number; lit: boolean }) {
  const abbr = itemAbbr(safeItemName(itemId));
  return (
    <>
      <span style={{ fontSize: 13, fontWeight: 600, color: "#d8c878", opacity: lit ? 1 : 0.9 }}>
        {abbr}
      </span>
      {affixCount > 0 && (
        <span
          style={{
            position: "absolute",
            bottom: 2,
            right: 3,
            fontSize: 10,
            opacity: 0.7,
            color: "#d8c878",
            lineHeight: 1,
          }}
        >
          +{affixCount}
        </span>
      )}
    </>
  );
}

// Reusable item slot cell — used by BagGrid (inventory) and PendingLootPanel.
//
// Renders a single square cell showing an item abbreviation + qty/affix badge.
// Accepts a unified "display item" shape so it can render both InventorySlot
// and PendingLootEntry data without knowing the source.

import { useState, type CSSProperties } from "react";
import { getContent } from "../../core/content";
import type { GearEntry, StackEntry } from "../../core/inventory";
import type { PendingLootEntry } from "../../core/world/stage/types";

// ---------- Layout constants (shared with grids) ----------

export const CELL_SIZE = 52;
export const CELL_GAP = 4;

export function slotGridStyle(): CSSProperties {
  return {
    gridTemplateColumns: `repeat(auto-fit, ${CELL_SIZE}px)`,
    justifyContent: "start",
  };
}

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
  const lit = hovered || selected;
  const isEmpty = item === null;

  const borderClass = selected
    ? "border-accent ring-1 ring-inset ring-accent"
    : isEmpty
      ? "border-border/40"
      : "border-border";

  const bgClass = isEmpty
    ? "bg-surface-dim"
    : lit
      ? "bg-surface-lighter"
      : "bg-surface-light";

  return (
    <div
      className={`w-[52px] h-[52px] rounded border ${borderClass} ${bgClass} relative flex items-center justify-center select-none transition-colors duration-75 overflow-hidden ${clickable ? "cursor-pointer" : ""}`}
      title={tooltip}
      onClick={clickable ? onClick : undefined}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {item?.kind === "stack" && <StackCellContent itemId={item.itemId} qty={item.qty} lit={lit} />}
      {item?.kind === "gear" && (
        <GearCellContent itemId={item.instance.itemId} affixCount={item.instance.rolledMods.length} lit={lit} />
      )}
    </div>
  );
}

// ---------- Cell content ----------

function StackCellContent({ itemId, qty, lit }: { itemId: string; qty: number; lit: boolean }) {
  const abbr = itemAbbr(safeItemName(itemId));
  return (
    <>
      <span className={`text-[13px] font-semibold text-teal-300 ${lit ? "opacity-100" : "opacity-90"}`}>
        {abbr}
      </span>
      <span className="absolute bottom-0.5 right-1 text-[10px] tabular-nums text-gray-300/80 leading-none">
        {qty}
      </span>
    </>
  );
}

function GearCellContent({ itemId, affixCount, lit }: { itemId: string; affixCount: number; lit: boolean }) {
  const abbr = itemAbbr(safeItemName(itemId));
  return (
    <>
      <span className={`text-[13px] font-semibold text-yellow-300 ${lit ? "opacity-100" : "opacity-90"}`}>
        {abbr}
      </span>
      {affixCount > 0 && (
        <span className="absolute bottom-0.5 right-1 text-[10px] text-yellow-300/70 leading-none">
          +{affixCount}
        </span>
      )}
    </>
  );
}

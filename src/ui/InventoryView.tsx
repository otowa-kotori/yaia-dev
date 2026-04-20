// Inventory panel — grid-based slot view for the hero's bags.
//
// Layout: fixed-size cells in a CSS grid. The container clips with
// `overflow: hidden` so any slots beyond the visible area are never rendered.
// Each cell is a square (CELL_SIZE × CELL_SIZE px); the grid width is
// COLS × CELL_SIZE + gap. No virtual scrolling needed for MVP bag sizes
// (≤40 slots).
//
// Slot rendering:
//   - null        → empty cell (dark, faint border)
//   - stack entry → item abbreviation + qty badge (bottom-right)
//   - gear entry  → item abbreviation in gold, optional affix count badge
//
// Read-only by design: the first inventory PR per roadmap explicitly asks
// for a minimal view, no equip / drag / drop / use. Those land in later PRs
// (equipment system, crafting). All we do here is render what's in state.
//
// Shows both bags the current save model has:
//   - the hero's personal bag (state.inventories[heroId])
//   - the shared bag (state.inventories["shared"])
// `BagGrid` renders a titled section for each.

import { useState } from "react";
import type { Modifier } from "../core/content/types";
import { getContent } from "../core/content";
import type {
  Inventory,
  InventorySlot,
  StackEntry,
  GearEntry,
} from "../core/inventory";
import { SHARED_INVENTORY_KEY } from "../core/state";
import type { GameStore } from "./store";
import { useStore } from "./useStore";

// ---------- Layout constants ----------

const COLS = 5;
const CELL_SIZE = 52; // px, including border
const CELL_GAP = 4;   // px between cells

export function InventoryView({ store }: { store: GameStore }) {
  const { store: s } = useStore(store);
  const hero = s.getHero();
  if (!hero) return null;

  const personal = s.state.inventories[hero.id] ?? null;
  const shared = s.state.inventories[SHARED_INVENTORY_KEY] ?? null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <BagGrid title={`${hero.name}'s Bag`} inv={personal} cols={COLS} />
      <BagGrid title="Shared" inv={shared} cols={COLS} />
    </div>
  );
}

// ---------- BagGrid ----------

function BagGrid({
  title,
  inv,
  cols,
}: {
  title: string;
  inv: Inventory | null;
  cols: number;
}) {
  if (!inv) {
    return (
      <div style={sectionStyle}>
        <div style={headerStyle}>{title}</div>
        <div style={{ fontSize: 12, opacity: 0.5 }}>— no bag —</div>
      </div>
    );
  }

  const used = inv.slots.reduce((n, s) => (s === null ? n : n + 1), 0);
  // Grid width: cols * cell + (cols-1) * gap
  const gridWidth = cols * CELL_SIZE + (cols - 1) * CELL_GAP;
  // Rows needed for capacity
  const rows = Math.ceil(inv.capacity / cols);

  return (
    <div style={sectionStyle}>
      <div style={headerStyle}>
        <span>{title}</span>
        <span style={{ opacity: 0.55, fontWeight: 400, fontSize: 11 }}>
          {used} / {inv.capacity}
        </span>
      </div>
      {/* overflow:hidden clips any slot that falls outside the rendered area */}
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
        {inv.slots.map((slot, i) => (
          <SlotCell key={i} slot={slot} index={i} />
        ))}
      </div>
    </div>
  );
}

// ---------- SlotCell ----------

function SlotCell({ slot, index }: { slot: InventorySlot; index: number }) {
  const [hovered, setHovered] = useState(false);

  const base: React.CSSProperties = {
    width: CELL_SIZE,
    height: CELL_SIZE,
    boxSizing: "border-box",
    border: `1px solid ${slot === null ? "#2a2a2a" : "#444"}`,
    borderRadius: 3,
    background: slot === null ? "#191919" : hovered ? "#2e2e2e" : "#242424",
    position: "relative",
    cursor: slot !== null ? "pointer" : "default",
    transition: "background 80ms",
    overflow: "hidden",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    userSelect: "none",
  };

  if (slot === null) {
    return <div style={base} title={`slot ${index}`} />;
  }

  if (slot.kind === "stack") {
    return (
      <StackCell
        style={base}
        slot={slot}
        hovered={hovered}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      />
    );
  }

  return (
    <GearCell
      style={base}
      slot={slot}
      hovered={hovered}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    />
  );
}

// ---------- Stack cell ----------

function StackCell({
  style,
  slot,
  hovered,
  onMouseEnter,
  onMouseLeave,
}: {
  style: React.CSSProperties;
  slot: StackEntry;
  hovered: boolean;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
}) {
  const name = safeItemName(slot.itemId);
  const abbr = itemAbbr(name);
  const tooltip = `${name} ×${slot.qty}`;

  return (
    <div
      style={style}
      title={tooltip}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      {/* Item abbreviation */}
      <span style={{ fontSize: 13, fontWeight: 600, color: "#9cb", opacity: hovered ? 1 : 0.9 }}>
        {abbr}
      </span>
      {/* Qty badge — bottom-right */}
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
        {slot.qty}
      </span>
    </div>
  );
}

// ---------- Gear cell ----------

function GearCell({
  style,
  slot,
  hovered,
  onMouseEnter,
  onMouseLeave,
}: {
  style: React.CSSProperties;
  slot: GearEntry;
  hovered: boolean;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
}) {
  const name = safeItemName(slot.instance.itemId);
  const abbr = itemAbbr(name);
  const affixCount = slot.instance.rolledMods.length;
  const affixSummary = slot.instance.rolledMods.map(formatModifier).join(", ");
  const tail = shortTail(slot.instance.instanceId);
  const tooltip = `${name}${affixSummary ? `  [${affixSummary}]` : ""}  ${tail}`;

  return (
    <div
      style={style}
      title={tooltip}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      {/* Item abbreviation in gear gold */}
      <span style={{ fontSize: 13, fontWeight: 600, color: "#d8c878", opacity: hovered ? 1 : 0.9 }}>
        {abbr}
      </span>
      {/* Affix count badge — bottom-right */}
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
    </div>
  );
}

// ---------- Helpers ----------

/** ItemDef lookup; fall back to the raw id if content was hot-reloaded away.
 *  (Not strictly needed under the alpha "throw loud" rule, but this is pure
 *  display — a missing name shouldn't crash the whole screen.) */
function safeItemName(itemId: string): string {
  const def = getContent().items[itemId];
  return def?.name ?? itemId;
}

/** Short 2–3 char abbreviation for display inside a cell.
 *  E.g. "Copper Ore" → "CO", "Iron Sword" → "IS", "Ruby" → "Ru" */
function itemAbbr(name: string): string {
  const words = name.split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) {
    const w = words[0]!;
    return w.length <= 3 ? w : w.slice(0, 2);
  }
  // Multi-word: take first letter of first two words, uppercase
  return (words[0]![0]! + words[1]![0]!).toUpperCase();
}

function formatModifier(m: Modifier): string {
  const stat = shortStat(m.stat);
  switch (m.op) {
    case "flat": {
      const sign = m.value >= 0 ? "+" : "";
      return `${sign}${m.value} ${stat}`;
    }
    case "pct_add":
    case "pct_mult": {
      const pct = Math.round(m.value * 100);
      const sign = pct >= 0 ? "+" : "";
      return `${sign}${pct}% ${stat}`;
    }
  }
}

/** Strip the `attr.` prefix for display. `attr.atk` → `atk`. */
function shortStat(statId: string): string {
  return statId.startsWith("attr.") ? statId.slice(5) : statId;
}

/** Last 6 chars of the gear instanceId so the player can tell two copies
 *  apart without showing the full opaque blob. */
function shortTail(instanceId: string): string {
  if (instanceId.length <= 8) return `#${instanceId}`;
  return `#${instanceId.slice(-6)}`;
}

// ---------- Styles ----------

const sectionStyle: React.CSSProperties = {
  padding: 10,
  background: "#222",
  borderRadius: 4,
};

const headerStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  fontWeight: 600,
  marginBottom: 8,
  fontSize: 13,
};

// Inventory panel — read-only listing of the hero's bags.
//
// Read-only by design: the first inventory PR per roadmap explicitly asks
// for a minimal list, no equip / drag / drop / use. Those land in later PRs
// (equipment system, crafting). All we do here is render what's in state.
//
// Shows both bags the current save model has:
//   - the hero's personal bag (state.inventories[heroId])
//   - the shared bag (state.inventories["shared"])
// Each bag prints its capacity and a numbered list of slots. Slot rendering:
//   - null        → "· empty"  (faded)
//   - stack entry → "<item name> ×<qty>"
//   - gear entry  → "<item name>  [+rolled affix summary]"  (italic instanceId tail)
//
// Gear affix text is terse: `+5 atk`, `+3 str`. Flat only for now because
// that's all ItemDef.roll produces; when we add pct affixes, extend
// formatModifier to print `5% atk` etc. Same logic lives exactly once.

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

export function InventoryView({ store }: { store: GameStore }) {
  const { store: s } = useStore(store);
  const hero = s.getHero();
  if (!hero) return null;

  const personal = s.state.inventories[hero.id] ?? null;
  const shared = s.state.inventories[SHARED_INVENTORY_KEY] ?? null;

  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ fontSize: 12, opacity: 0.6, marginBottom: 4 }}>
        Inventory
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 8,
        }}
      >
        <BagCard title={`${hero.name}'s Bag`} inv={personal} />
        <BagCard title="Shared" inv={shared} />
      </div>
    </div>
  );
}

function BagCard({ title, inv }: { title: string; inv: Inventory | null }) {
  if (!inv) {
    return (
      <div style={cardStyle}>
        <div style={headerStyle}>{title}</div>
        <div style={{ fontSize: 12, opacity: 0.5 }}>— no bag —</div>
      </div>
    );
  }

  const used = inv.slots.reduce((n, s) => (s === null ? n : n + 1), 0);

  return (
    <div style={cardStyle}>
      <div style={headerStyle}>
        <span>{title}</span>
        <span style={{ opacity: 0.55, fontWeight: 400, fontSize: 11 }}>
          {used} / {inv.capacity}
        </span>
      </div>
      <div
        style={{
          fontFamily: "ui-monospace, Menlo, monospace",
          fontSize: 12,
          maxHeight: 220,
          overflow: "auto",
          display: "flex",
          flexDirection: "column",
          gap: 2,
        }}
      >
        {inv.slots.map((slot, i) => (
          <SlotRow key={i} index={i} slot={slot} />
        ))}
      </div>
    </div>
  );
}

function SlotRow({ index, slot }: { index: number; slot: InventorySlot }) {
  const idx = String(index).padStart(2, "0");
  if (slot === null) {
    return (
      <div style={{ opacity: 0.35 }}>
        {idx} · empty
      </div>
    );
  }
  if (slot.kind === "stack") {
    return <StackRow index={idx} slot={slot} />;
  }
  return <GearRow index={idx} slot={slot} />;
}

function StackRow({ index, slot }: { index: string; slot: StackEntry }) {
  const name = safeItemName(slot.itemId);
  return (
    <div>
      <span style={{ opacity: 0.5 }}>{index}</span>{" "}
      <span>{name}</span>{" "}
      <span style={{ opacity: 0.7 }}>×{slot.qty}</span>
    </div>
  );
}

function GearRow({ index, slot }: { index: string; slot: GearEntry }) {
  const name = safeItemName(slot.instance.itemId);
  const affix = slot.instance.rolledMods.map(formatModifier).join(", ");
  const tail = shortTail(slot.instance.instanceId);
  return (
    <div>
      <span style={{ opacity: 0.5 }}>{index}</span>{" "}
      <span style={{ color: "#d8c878" }}>{name}</span>
      {affix ? (
        <span style={{ opacity: 0.75 }}> [{affix}]</span>
      ) : null}
      <span style={{ opacity: 0.35, fontStyle: "italic" }}> {tail}</span>
    </div>
  );
}

/** ItemDef lookup; fall back to the raw id if content was hot-reloaded away.
 *  (Not strictly needed under the alpha "throw loud" rule, but this is pure
 *  display — a missing name shouldn't crash the whole screen.) */
function safeItemName(itemId: string): string {
  const def = getContent().items[itemId];
  return def?.name ?? itemId;
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

const cardStyle: React.CSSProperties = {
  padding: 10,
  background: "#222",
  borderRadius: 4,
};

const headerStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  fontWeight: 600,
  marginBottom: 6,
  fontSize: 13,
};

// Inventory panel — bag grids + item details + equipment management.
//
// This file used to be read-only. It now owns the first layer of inventory
// interaction:
//   - click a bag slot to inspect the item in a side panel
//   - equip equippable gear directly from the bag
//   - inspect currently equipped items and unequip them
//
// Scope stays intentionally narrow:
//   - no drag/drop
//   - no split stacks
//   - no discard / sell / consume actions
// Those can stack on top later without changing the underlying session API.

import { useState } from "react";
import type { ItemDef, Modifier } from "../core/content/types";
import { getContent } from "../core/content";
import type {
  GearEntry,
  Inventory,
  InventorySlot,
  StackEntry,
} from "../core/inventory";
import { SHARED_INVENTORY_KEY } from "../core/state";
import type { GameStore } from "./store";
import { useStore } from "./useStore";

// ---------- Layout constants ----------

const COLS = 5;
const CELL_SIZE = 52;
const CELL_GAP = 4;

interface SelectionState {
  inventoryOwnerId: string;
  inventoryTitle: string;
  slotIndex: number;
}

export function InventoryView({ store }: { store: GameStore }) {
  const { store: s } = useStore(store);
  const cc = s.getFocusedCharacter();
  const hero = cc.hero;
  const [selected, setSelected] = useState<SelectionState | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  if (!hero) return null;

  const personal = s.state.inventories[hero.id] ?? null;
  const shared = s.state.inventories[SHARED_INVENTORY_KEY] ?? null;
  const selectedSlot =
    selected === null
      ? null
      : s.state.inventories[selected.inventoryOwnerId]?.slots[selected.slotIndex] ?? null;

  function clearError(): void {
    setActionError(null);
  }

  function selectSlot(inventoryOwnerId: string, inventoryTitle: string, slotIndex: number): void {
    clearError();
    setSelected({ inventoryOwnerId, inventoryTitle, slotIndex });
  }

  function handleEquip(): void {
    if (!selected) return;
    try {
      cc.equipItem(selected.slotIndex);
      clearError();
      setSelected(null);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "装备失败");
    }
  }

  function handleUnequip(slot: string): void {
    try {
      cc.unequipItem(slot);
      clearError();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "卸下失败");
    }
  }

  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 16, alignItems: "flex-start" }}>
      <div style={{ flex: "1 1 320px", minWidth: 280, display: "flex", flexDirection: "column", gap: 12 }}>
        {actionError && <ErrorBanner message={actionError} />}
        <BagGrid
          title={`${hero.name}'s Bag`}
          inventoryOwnerId={hero.id}
          inv={personal}
          cols={COLS}
          selectedIndex={selected?.inventoryOwnerId === hero.id ? selected.slotIndex : null}
          onSelect={selectSlot}
        />
        <BagGrid
          title="Shared"
          inventoryOwnerId={SHARED_INVENTORY_KEY}
          inv={shared}
          cols={COLS}
          selectedIndex={selected?.inventoryOwnerId === SHARED_INVENTORY_KEY ? selected.slotIndex : null}
          onSelect={selectSlot}
        />
      </div>

      <div style={{ flex: "0 0 260px", width: 260, display: "flex", flexDirection: "column", gap: 12 }}>
        <ItemDetailsPanel
          heroName={hero.name}
          selected={selected}
          selectedSlot={selectedSlot}
          onEquip={handleEquip}
        />
        <EquipmentPanel hero={hero} onUnequip={handleUnequip} />
      </div>
    </div>
  );
}

// ---------- BagGrid ----------

function BagGrid({
  title,
  inventoryOwnerId,
  inv,
  cols,
  selectedIndex,
  onSelect,
}: {
  title: string;
  inventoryOwnerId: string;
  inv: Inventory | null;
  cols: number;
  selectedIndex: number | null;
  onSelect: (inventoryOwnerId: string, inventoryTitle: string, slotIndex: number) => void;
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
  const gridWidth = cols * CELL_SIZE + (cols - 1) * CELL_GAP;
  const rows = Math.ceil(inv.capacity / cols);

  return (
    <div style={sectionStyle}>
      <div style={headerStyle}>
        <span>{title}</span>
        <span style={{ opacity: 0.55, fontWeight: 400, fontSize: 11 }}>
          {used} / {inv.capacity}
        </span>
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
        {inv.slots.map((slot, i) => (
          <SlotCell
            key={i}
            slot={slot}
            index={i}
            selected={selectedIndex === i}
            onSelect={() => onSelect(inventoryOwnerId, title, i)}
          />
        ))}
      </div>
    </div>
  );
}

// ---------- Slot cell ----------

function SlotCell({
  slot,
  index,
  selected,
  onSelect,
}: {
  slot: InventorySlot;
  index: number;
  selected: boolean;
  onSelect: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  const clickable = slot !== null;

  const base: React.CSSProperties = {
    width: CELL_SIZE,
    height: CELL_SIZE,
    boxSizing: "border-box",
    border: `1px solid ${selected ? "#4a9" : slot === null ? "#2a2a2a" : "#444"}`,
    boxShadow: selected ? "0 0 0 1px #4a9 inset" : undefined,
    borderRadius: 3,
    background: slot === null ? "#191919" : hovered || selected ? "#2e2e2e" : "#242424",
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
      title={buildSlotTooltip(slot, index)}
      onClick={clickable ? onSelect : undefined}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {slot?.kind === "stack" && <StackContent slot={slot} hovered={hovered || selected} />}
      {slot?.kind === "gear" && <GearContent slot={slot} hovered={hovered || selected} />}
    </div>
  );
}

function StackContent({
  slot,
  hovered,
}: {
  slot: StackEntry;
  hovered: boolean;
}) {
  const name = safeItemName(slot.itemId);
  const abbr = itemAbbr(name);

  return (
    <>
      <span style={{ fontSize: 13, fontWeight: 600, color: "#9cb", opacity: hovered ? 1 : 0.9 }}>
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
        {slot.qty}
      </span>
    </>
  );
}

function GearContent({
  slot,
  hovered,
}: {
  slot: GearEntry;
  hovered: boolean;
}) {
  const name = safeItemName(slot.instance.itemId);
  const abbr = itemAbbr(name);
  const affixCount = slot.instance.rolledMods.length;

  return (
    <>
      <span style={{ fontSize: 13, fontWeight: 600, color: "#d8c878", opacity: hovered ? 1 : 0.9 }}>
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

// ---------- Details panel ----------

function ItemDetailsPanel({
  heroName,
  selected,
  selectedSlot,
  onEquip,
}: {
  heroName: string;
  selected: SelectionState | null;
  selectedSlot: InventorySlot;
  onEquip: () => void;
}) {
  if (!selected || !selectedSlot) {
    return (
      <div style={sectionStyle}>
        <div style={headerStyle}>物品详情</div>
        <div style={{ fontSize: 12, lineHeight: 1.6, opacity: 0.68 }}>
          点击背包中的物品后，这里会显示它的来源、类型、属性和操作入口。
        </div>
      </div>
    );
  }

  const itemId = selectedSlot.kind === "stack" ? selectedSlot.itemId : selectedSlot.instance.itemId;
  const def = getContent().items[itemId] as ItemDef | undefined;
  if (!def) {
    return (
      <div style={sectionStyle}>
        <div style={headerStyle}>物品详情</div>
        <div style={{ fontSize: 12, color: "#f88" }}>缺少物品定义：{itemId}</div>
      </div>
    );
  }

  const isGear = selectedSlot.kind === "gear";
  const rolledMods = isGear ? selectedSlot.instance.rolledMods : [];
  const allMods = [...(def.modifiers ?? []), ...rolledMods];
  const canEquip = isGear && Boolean(def.slot);

  return (
    <div style={sectionStyle}>
      <div style={headerStyle}>物品详情</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 700, color: "#fff", marginBottom: 4 }}>{def.name}</div>
          <div style={{ fontSize: 12, opacity: 0.58 }}>
            {selected.inventoryTitle} · 槽位 {selected.slotIndex + 1}
          </div>
        </div>

        {def.description && (
          <div style={{ fontSize: 12, lineHeight: 1.6, color: "#cfcfcf" }}>{def.description}</div>
        )}

        <InfoRow label="类型" value={def.stackable ? "材料" : "装备"} />
        {selectedSlot.kind === "stack" && <InfoRow label="数量" value={`×${selectedSlot.qty}`} />}
        {def.slot && <InfoRow label="装备槽位" value={slotLabel(def.slot)} />}
        {selectedSlot.kind === "gear" && (
          <InfoRow label="实例" value={shortTail(selectedSlot.instance.instanceId)} />
        )}
        {def.tags?.length ? <InfoRow label="标签" value={def.tags.join(" / ")} /> : null}

        <ModifierList title="属性效果" modifiers={allMods} emptyLabel="无属性加成" />

        {canEquip && (
          <button onClick={onEquip} style={primaryButtonStyle}>
            装备到{heroName}
          </button>
        )}
      </div>
    </div>
  );
}

function EquipmentPanel({
  hero,
  onUnequip,
}: {
  hero: GameStore["state"]["actors"][number] & { equipped: Record<string, import("../core/item").GearInstance | null> };
  onUnequip: (slot: string) => void;
}) {
  const content = getContent();
  const definedSlots = Object.values(content.items)
    .map((item) => item.slot)
    .filter((slot): slot is string => Boolean(slot));
  const slots = sortEquipmentSlots([...new Set([...definedSlots, ...Object.keys(hero.equipped)])]);

  return (
    <div style={sectionStyle}>
      <div style={headerStyle}>装备面板</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {slots.map((slot) => {
          const equipped = hero.equipped[slot] ?? null;
          const def = equipped ? content.items[equipped.itemId] : null;
          return (
            <div key={slot} style={equipmentRowStyle}>
              <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                <div style={{ fontSize: 12, opacity: 0.55 }}>{slotLabel(slot)}</div>
                <div style={{ fontSize: 13, color: equipped ? "#fff" : "#777" }}>
                  {equipped && def ? def.name : "未装备"}
                </div>
                {equipped && def?.modifiers?.length ? (
                  <div style={{ fontSize: 11, opacity: 0.65 }}>
                    {def.modifiers.map(formatModifier).join(" · ")}
                  </div>
                ) : null}
              </div>
              <button
                onClick={() => onUnequip(slot)}
                disabled={!equipped}
                style={{
                  ...secondaryButtonStyle,
                  opacity: equipped ? 1 : 0.45,
                  cursor: equipped ? "pointer" : "default",
                }}
              >
                卸下
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ModifierList({
  title,
  modifiers,
  emptyLabel,
}: {
  title: string;
  modifiers: Modifier[];
  emptyLabel: string;
}) {
  return (
    <div>
      <div style={{ fontSize: 11, opacity: 0.5, marginBottom: 6, letterSpacing: 0.4 }}>{title}</div>
      {modifiers.length === 0 ? (
        <div style={{ fontSize: 12, opacity: 0.55 }}>{emptyLabel}</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {modifiers.map((modifier, index) => (
            <div key={`${modifier.sourceId}:${index}`} style={{ fontSize: 12 }}>
              {formatModifier(modifier)}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, fontSize: 12 }}>
      <span style={{ opacity: 0.55 }}>{label}</span>
      <span style={{ textAlign: "right" }}>{value}</span>
    </div>
  );
}

function ErrorBanner({ message }: { message: string }) {
  return (
    <div
      style={{
        padding: "8px 10px",
        background: "#3a1f1f",
        border: "1px solid #6d3636",
        borderRadius: 4,
        fontSize: 12,
        color: "#ffb3b3",
      }}
    >
      {message}
    </div>
  );
}

// ---------- Helpers ----------

function buildSlotTooltip(slot: InventorySlot, index: number): string {
  if (slot === null) return `slot ${index}`;
  if (slot.kind === "stack") return `${safeItemName(slot.itemId)} ×${slot.qty}`;
  const name = safeItemName(slot.instance.itemId);
  const affixSummary = slot.instance.rolledMods.map(formatModifier).join(", ");
  return `${name}${affixSummary ? `  [${affixSummary}]` : ""}  ${shortTail(slot.instance.instanceId)}`;
}

function safeItemName(itemId: string): string {
  const def = getContent().items[itemId];
  return def?.name ?? itemId;
}

function itemAbbr(name: string): string {
  const words = name.split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) {
    const word = words[0]!;
    return word.length <= 3 ? word : word.slice(0, 2);
  }
  return (words[0]![0]! + words[1]![0]!).toUpperCase();
}

function formatModifier(modifier: Modifier): string {
  const stat = shortStat(modifier.stat);
  switch (modifier.op) {
    case "flat": {
      const sign = modifier.value >= 0 ? "+" : "";
      return `${sign}${modifier.value} ${stat}`;
    }
    case "pct_add":
    case "pct_mult": {
      const pct = Math.round(modifier.value * 100);
      const sign = pct >= 0 ? "+" : "";
      return `${sign}${pct}% ${stat}`;
    }
  }
}

function shortStat(statId: string): string {
  return statId.startsWith("attr.") ? statId.slice(5) : statId;
}

function shortTail(instanceId: string): string {
  if (instanceId.length <= 8) return `#${instanceId}`;
  return `#${instanceId.slice(-6)}`;
}

function slotLabel(slot: string): string {
  switch (slot) {
    case "weapon":
      return "武器";
    case "offhand":
      return "副手";
    case "helmet":
      return "头部";
    case "chest":
      return "胸甲";
    case "gloves":
      return "手部";
    case "boots":
      return "鞋子";
    case "ring":
      return "戒指";
    case "amulet":
      return "项链";
    default:
      return slot;
  }
}

function sortEquipmentSlots(slots: string[]): string[] {
  const order = ["weapon", "offhand", "helmet", "chest", "gloves", "boots", "ring", "amulet"];
  return [...slots].sort((a, b) => {
    const ai = order.indexOf(a);
    const bi = order.indexOf(b);
    if (ai === -1 && bi === -1) return a.localeCompare(b);
    if (ai === -1) return 1;
    if (bi === -1) return -1;
    return ai - bi;
  });
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

const equipmentRowStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  gap: 12,
  alignItems: "center",
  padding: "8px 10px",
  borderRadius: 4,
  background: "#1b1b1b",
};

const primaryButtonStyle: React.CSSProperties = {
  padding: "8px 12px",
  borderRadius: 4,
  border: "1px solid #2f7a5f",
  background: "#2a5",
  color: "#fff",
  cursor: "pointer",
  fontFamily: "inherit",
  fontSize: 12,
};

const secondaryButtonStyle: React.CSSProperties = {
  padding: "6px 10px",
  borderRadius: 4,
  border: "1px solid #444",
  background: "#2a2a2a",
  color: "#fff",
  cursor: "pointer",
  fontFamily: "inherit",
  fontSize: 12,
};

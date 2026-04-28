// Inventory panel — bag grids + item details + equipment / transfer management.
//
// Current interactions:
//   - click a bag slot to inspect it in the side panel
//   - equip equippable gear directly from the personal bag
//   - move whole slots between the personal bag and shared inventory
//   - discard the selected slot from either inventory
//   - inspect currently equipped items and unequip them
//
// Desktop layout: grid-cols-[1fr_280px] (bags | details + equipment).
// Bag grids auto-wrap based on the available panel width instead of pinning to 5 columns.

import { useState } from "react";
import type { ItemDef, Modifier } from "../../core/content/types";
import { getContent } from "../../core/content";
import type { Inventory, InventorySlot } from "../../core/inventory";
import { SHARED_INVENTORY_KEY } from "../../core/infra/state";
import type { GameStore } from "../store";
import { useStore } from "../hooks/useStore";
import { T, slotLabel, fmt } from "../text";
import { Card } from "../components/Card";
import { ItemSlotCell, safeItemName, slotGridStyle } from "../components/ItemSlot";
import { PendingLootPanel } from "../components/PendingLootPanel";

interface SelectionState {
  inventoryOwnerId: string;
  inventoryTitle: string;
  slotIndex: number;
}

export function InventoryPanel({ store }: { store: GameStore }) {
  const { store: s } = useStore(store);
  const cc = s.focused;
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
      setActionError(error instanceof Error ? error.message : T.equipFailed);
    }
  }

  function handleUnequip(slot: string): void {
    try {
      cc.unequipItem(slot);
      clearError();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : T.unequipFailed);
    }
  }

  function handleStoreInShared(): void {
    if (!selected) return;
    try {
      cc.storeItemInShared(selected.slotIndex);
      clearError();
      setSelected(null);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : T.storeInSharedFailed);
    }
  }

  function handleTakeFromShared(): void {
    if (!selected) return;
    try {
      cc.takeItemFromShared(selected.slotIndex);
      clearError();
      setSelected(null);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : T.takeFromSharedFailed);
    }
  }

  function handleDiscard(): void {
    if (!selected || !selectedSlot) return;
    const itemId = selectedSlot.kind === "stack" ? selectedSlot.itemId : selectedSlot.instance.itemId;
    const itemName = safeItemName(itemId);
    if (!confirm(fmt(T.confirmDiscardItem, { name: itemName }))) {
      return;
    }

    try {
      cc.discardInventoryItem(selected.inventoryOwnerId, selected.slotIndex);
      clearError();
      setSelected(null);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : T.discardFailed);
    }
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-4 items-start">
      {/* Left column — bags + pending loot */}
      <div className="flex flex-col gap-3">
        {actionError && <ErrorBanner message={actionError} />}
        <BagGrid
          title={fmt(T.heroBag, { name: hero.name })}
          inventoryOwnerId={hero.id}
          inv={personal}
          selectedIndex={selected?.inventoryOwnerId === hero.id ? selected.slotIndex : null}
          onSelect={selectSlot}
        />
        <PendingLootPanel cc={cc} pendingLoot={cc.stageSession?.pendingLoot ?? []} />
        <BagGrid
          title={T.bagShared}
          inventoryOwnerId={SHARED_INVENTORY_KEY}
          inv={shared}
          selectedIndex={selected?.inventoryOwnerId === SHARED_INVENTORY_KEY ? selected.slotIndex : null}
          onSelect={selectSlot}
        />
      </div>

      {/* Right column — details + equipment */}
      <div className="flex flex-col gap-3">
        <ItemDetailsPanel
          heroName={hero.name}
          heroInventoryOwnerId={hero.id}
          selected={selected}
          selectedSlot={selectedSlot}
          onEquip={handleEquip}
          onStoreInShared={handleStoreInShared}
          onTakeFromShared={handleTakeFromShared}
          onDiscard={handleDiscard}
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
  selectedIndex,
  onSelect,
}: {
  title: string;
  inventoryOwnerId: string;
  inv: Inventory | null;
  selectedIndex: number | null;
  onSelect: (inventoryOwnerId: string, inventoryTitle: string, slotIndex: number) => void;
}) {
  if (!inv) {
    return (
      <Card className="p-3">
        <div className="flex justify-between font-semibold mb-2 text-[13px]">{title}</div>
        <div className="text-xs opacity-50">{T.noBag}</div>
      </Card>
    );
  }

  const used = inv.slots.reduce((n, s) => (s === null ? n : n + 1), 0);

  return (
    <Card className="p-3">
      <div className="flex justify-between font-semibold mb-2 text-[13px]">
        <span>{title}</span>
        <span className="opacity-55 font-normal text-[11px]">
          {used} / {inv.capacity}
        </span>
      </div>
      <div className="grid gap-1 overflow-hidden" style={slotGridStyle()}>
        {inv.slots.map((slot, i) => (
          <ItemSlotCell
            key={i}
            item={slot}
            selected={selectedIndex === i}
            onClick={slot !== null ? () => onSelect(inventoryOwnerId, title, i) : undefined}
            tooltip={buildSlotTooltip(slot, i)}
          />
        ))}
      </div>
    </Card>
  );
}

// ---------- Details panel ----------

function ItemDetailsPanel({
  heroName,
  heroInventoryOwnerId,
  selected,
  selectedSlot,
  onEquip,
  onStoreInShared,
  onTakeFromShared,
  onDiscard,
}: {
  heroName: string;
  heroInventoryOwnerId: string;
  selected: SelectionState | null;
  selectedSlot: InventorySlot;
  onEquip: () => void;
  onStoreInShared: () => void;
  onTakeFromShared: () => void;
  onDiscard: () => void;
}) {
  if (!selected || !selectedSlot) {
    return (
      <Card className="p-3">
        <div className="flex justify-between font-semibold mb-2 text-[13px]">{T.itemDetails}</div>
        <div className="text-xs leading-relaxed opacity-68">
          {T.itemDetailsHint}
        </div>
      </Card>
    );
  }

  const itemId = selectedSlot.kind === "stack" ? selectedSlot.itemId : selectedSlot.instance.itemId;
  const def = getContent().items[itemId] as ItemDef | undefined;
  if (!def) {
    return (
      <Card className="p-3">
        <div className="flex justify-between font-semibold mb-2 text-[13px]">{T.itemDetails}</div>
        <div className="text-xs text-red-400">{T.missingItemDef}{itemId}</div>
      </Card>
    );
  }

  const isGear = selectedSlot.kind === "gear";
  const rolledMods = isGear ? selectedSlot.instance.rolledMods : [];
  const allMods = [...(def.modifiers ?? []), ...rolledMods];
  const isInHeroBag = selected.inventoryOwnerId === heroInventoryOwnerId;
  const isInShared = selected.inventoryOwnerId === SHARED_INVENTORY_KEY;
  const canEquip = isGear && Boolean(def.slot) && isInHeroBag;

  return (
    <Card className="p-3">
      <div className="flex justify-between font-semibold mb-2 text-[13px]">{T.itemDetails}</div>
      <div className="flex flex-col gap-2.5">
        <div>
          <div className="text-base font-bold text-white mb-1">{def.name}</div>
          <div className="text-xs opacity-58">
            {selected.inventoryTitle} · 槽位 {selected.slotIndex + 1}
          </div>
        </div>

        {def.description && (
          <div className="text-xs leading-relaxed text-gray-300">{def.description}</div>
        )}

        <InfoRow label={T.label_type} value={def.stackable ? T.type_material : T.type_equipment} />
        {selectedSlot.kind === "stack" && <InfoRow label={T.label_quantity} value={`×${selectedSlot.qty}`} />}
        {def.slot && <InfoRow label={T.label_equipSlot} value={slotLabel(def.slot)} />}
        {selectedSlot.kind === "gear" && (
          <InfoRow label={T.label_instance} value={shortTail(selectedSlot.instance.instanceId)} />
        )}
        {def.tags?.length ? <InfoRow label={T.label_tags} value={def.tags.join(" / ")} /> : null}

        <ModifierList title={T.modifierEffects} modifiers={allMods} emptyLabel={T.noModifiers} />

        <div className="flex flex-col gap-2">
          {canEquip && (
            <button
              type="button"
              onClick={onEquip}
              className="px-3 py-2 rounded border border-green-700 bg-green-700 text-white text-xs font-inherit cursor-pointer hover:bg-green-600 transition-colors"
            >
              {fmt(T.equipTo, { name: heroName })}
            </button>
          )}
          {isInHeroBag && (
            <button
              type="button"
              onClick={onStoreInShared}
              className="px-3 py-2 rounded border border-border bg-surface-light text-white text-xs font-inherit cursor-pointer hover:bg-surface-lighter transition-colors"
            >
              {T.btn_storeInShared}
            </button>
          )}
          {isInShared && (
            <button
              type="button"
              onClick={onTakeFromShared}
              className="px-3 py-2 rounded border border-border bg-surface-light text-white text-xs font-inherit cursor-pointer hover:bg-surface-lighter transition-colors"
            >
              {fmt(T.btn_takeFromShared, { name: heroName })}
            </button>
          )}
          <button
            type="button"
            onClick={onDiscard}
            className="px-3 py-2 rounded border border-red-700/70 bg-red-900/20 text-red-200 text-xs font-inherit cursor-pointer hover:bg-red-900/35 transition-colors"
          >
            {T.btn_discard}
          </button>
        </div>
      </div>
    </Card>
  );
}

// ---------- Equipment panel ----------

function EquipmentPanel({
  hero,
  onUnequip,
}: {
  hero: GameStore["state"]["actors"][number] & { equipped: Record<string, import("../../core/item").GearInstance | null> };
  onUnequip: (slot: string) => void;
}) {
  const content = getContent();
  const definedSlots = Object.values(content.items)
    .map((item) => item.slot)
    .filter((slot): slot is string => Boolean(slot));
  const slots = sortEquipmentSlots([...new Set([...definedSlots, ...Object.keys(hero.equipped)])]);

  return (
    <Card className="p-3">
      <div className="flex justify-between font-semibold mb-2 text-[13px]">{T.equipPanel}</div>
      <div className="flex flex-col gap-2">
        {slots.map((slot) => {
          const equipped = hero.equipped[slot] ?? null;
          const def = equipped ? content.items[equipped.itemId] : null;
          return (
            <div key={slot} className="flex justify-between gap-3 items-center p-2 rounded bg-surface-dim">
              <div className="flex flex-col gap-0.5">
                <div className="text-xs opacity-55">{slotLabel(slot)}</div>
                <div className={`text-[13px] ${equipped ? "text-white" : "text-gray-500"}`}>
                  {equipped && def ? def.name : T.unequipped}
                </div>
                {equipped && def?.modifiers?.length ? (
                  <div className="text-[11px] opacity-65">
                    {def.modifiers.map(formatModifier).join(" · ")}
                  </div>
                ) : null}
              </div>
              <button
                onClick={() => onUnequip(slot)}
                disabled={!equipped}
                className={`px-2.5 py-1.5 rounded border border-border bg-surface-light text-white text-xs font-inherit ${
                  equipped ? "cursor-pointer hover:bg-surface-lighter" : "opacity-45 cursor-default"
                } transition-colors`}
              >
                {T.btn_unequip}
              </button>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

// ---------- Modifier list ----------

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
      <div className="text-[11px] opacity-50 mb-1.5 tracking-wide">{title}</div>
      {modifiers.length === 0 ? (
        <div className="text-xs opacity-55">{emptyLabel}</div>
      ) : (
        <div className="flex flex-col gap-1">
          {modifiers.map((modifier, index) => (
            <div key={`${modifier.sourceId}:${index}`} className="text-xs">
              {formatModifier(modifier)}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------- Shared sub-components ----------

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3 text-xs">
      <span className="opacity-55">{label}</span>
      <span className="text-right">{value}</span>
    </div>
  );
}

function ErrorBanner({ message }: { message: string }) {
  return (
    <div className="px-2.5 py-2 bg-red-900/30 border border-red-700/40 rounded text-xs text-red-300">
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

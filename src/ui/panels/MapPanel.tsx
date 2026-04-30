// MapPanel — location selection + entry list.
//
// Standalone panel for choosing where to go. Previously embedded in BattlePanel,
// now lives as its own tab so it doesn't clutter the battle view.

import { useState } from "react";
import { getContent, getNpc } from "../../core/content";
import type { GameStore } from "../store";
import { useStore } from "../hooks/useStore";
import { T, fmt } from "../text";
import { Card } from "../components/Card";
import { PartyDialog, type PartyDialogMode } from "../components/PartyDialog";

export function MapPanel({
  store,
  onActivityStarted,
}: {
  store: GameStore;
  onActivityStarted?: () => void;
}) {
  const { store: s } = useStore(store);
  const cc = s.focused;

  const locationIds = s.listLocationIds();
  const currentLocationId = cc.hero.locationId;
  const content = getContent();
  const stage = cc.stageSession;

  return (
    <div>
      {/* Location buttons */}
      <div className="text-[11px] uppercase tracking-wider text-gray-500 mb-2">{T.label_location}</div>
      <div className="flex gap-2 flex-wrap mb-4">
        {locationIds.map((id) => {
          const location = content.locations[id];
          const isLocked = !!location?.unlockId && !s.isUnlocked(location.unlockId);
          return (
            <button
              key={id}
              type="button"
              disabled={isLocked}
              onClick={() => {
                const pending = cc.stageSession?.pendingLoot ?? [];
                if (pending.length > 0) {
                  if (!confirm(T.confirmLeavePendingLoot)) return;
                }
                cc.enterLocation(id);
              }}
              className={`px-4 py-2 rounded-lg text-sm transition-colors border
              ${isLocked
                  ? "bg-surface text-gray-600 border-border cursor-not-allowed"
                  : currentLocationId === id
                    ? "bg-accent/20 text-accent border-accent/30 cursor-pointer"
                    : "bg-surface-light text-gray-400 border-border hover:border-border-light cursor-pointer"}`}
              title={isLocked ? fmt(T.unlockGateLockedInline, { unlockId: location.unlockId! }) : undefined}
            >
              {location?.name ?? id}
            </button>
          );
        })}
      </div>

      {/* Entry list for current location */}
      {currentLocationId && !stage && (
        <EntryList
          locationId={currentLocationId}
          store={s}
          onActivityStarted={onActivityStarted}
        />
      )}

      {/* Current location info */}
      {currentLocationId && (
        <Card className="mt-4 p-3">
          <div className="text-[11px] uppercase tracking-wider text-gray-500 mb-1">
            {T.label_location}
          </div>
          <div className="text-white font-semibold">
            {content.locations[currentLocationId]?.name ?? currentLocationId}
          </div>
        </Card>
      )}
    </div>
  );
}

function EntryList({
  locationId,
  store,
  onActivityStarted,
}: {
  locationId: string;
  store: GameStore;
  onActivityStarted?: () => void;
}) {
  const cc = store.focused;

  const content = getContent();
  const [pendingEntry, setPendingEntry] = useState<{
    mode: PartyDialogMode;
    targetId: string;
  } | null>(null);
  const loc = content.locations[locationId];
  if (!loc) return null;

  return (
    <>
      <div className="text-[11px] uppercase tracking-wider text-gray-500 mb-2">
        {T.entry_combat}
      </div>
      <div className="flex gap-2 flex-wrap">
        {loc.entries.map((entry, i) => {
          const label = entry.label ?? (entry.kind === "combat" ? T.entry_combat : entry.kind === "gather" ? T.entry_gather : entry.kind === "npc" ? getNpc(entry.npcId).name : T.entry_combat);
          const isLocked = !!entry.unlockId && !store.isUnlocked(entry.unlockId);
          return (
            <button
              key={i}
              type="button"
              disabled={isLocked}
              onClick={() => {
                if (entry.kind === "combat") {
                  setPendingEntry({ mode: "combat", targetId: entry.combatZoneId });
                } else if (entry.kind === "gather") {
                  const nodeId = entry.resourceNodes[0];
                  if (nodeId) {
                    cc.startGather(nodeId);
                    onActivityStarted?.();
                  }
                } else if (entry.kind === "dungeon") {
                  setPendingEntry({ mode: "dungeon", targetId: entry.dungeonId });
                } else if (entry.kind === "npc") {
                  const npc = getNpc(entry.npcId);
                  store.openDialogue(npc.dialogueId);
                }
              }}
              className={`px-4 py-2 rounded-lg text-sm border transition-colors ${
                isLocked
                  ? "bg-surface text-gray-600 border-border cursor-not-allowed"
                  : "bg-surface-light text-gray-300 border-border hover:border-border-light cursor-pointer"
              }`}
              title={isLocked ? fmt(T.unlockGateLockedInline, { unlockId: entry.unlockId! }) : undefined}
            >
              {label}
            </button>
          );
        })}
      </div>
      <PartyDialog
        store={store}
        mode={pendingEntry?.mode ?? "combat"}
        targetId={pendingEntry?.targetId ?? null}
        isOpen={pendingEntry !== null}
        onClose={() => setPendingEntry(null)}
        onConfirm={(partyCharIds) => {
          if (!pendingEntry) return;
          if (pendingEntry.mode === "dungeon") {
            store.startDungeon(pendingEntry.targetId, partyCharIds);
          } else {
            store.startPartyCombat(pendingEntry.targetId, partyCharIds);
          }
          setPendingEntry(null);
          onActivityStarted?.();
        }}
      />
    </>
  );
}

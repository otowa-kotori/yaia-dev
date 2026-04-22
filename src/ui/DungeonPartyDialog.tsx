// Dungeon party setup dialog.
//
// Opens from a dungeon location entry, lets the player choose a party, then
// hands the selected character ids back to the caller for the actual session
// command. Validation is kept on the UI side so the confirm button is only
// enabled when the party size is legal.

import { useEffect, useMemo, useState } from "react";
import { getContent } from "../core/content";
import type { GameStore } from "./store";
import { useStore } from "./useStore";
import {
  CharacterSelectButtons,
  getCharacterSelectStatusLabel,
} from "./CharacterSelectButtons";
import { Modal } from "./Modal";
import { T, fmt } from "./text";

export interface DungeonPartyDialogProps {
  store: GameStore;
  dungeonId: string | null;
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (partyCharIds: string[]) => void;
}

export function DungeonPartyDialog({
  store,
  dungeonId,
  isOpen,
  onClose,
  onConfirm,
}: DungeonPartyDialogProps) {
  const { store: s } = useStore(store);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  const dungeon = dungeonId ? getContent().dungeons[dungeonId] ?? null : null;
  const heroes = s.listHeroes();
  const focusedHeroId = heroes.find((hero) => hero.id === s.focusedCharId)?.id ?? heroes[0]?.id ?? null;
  const minPartySize = Math.max(1, dungeon?.minPartySize ?? 1);
  const maxPartySize = Math.max(minPartySize, dungeon?.maxPartySize ?? heroes.length);


  useEffect(() => {
    if (!isOpen) return;
    setSelectedIds(focusedHeroId ? [focusedHeroId] : []);
  }, [focusedHeroId, isOpen, dungeonId]);

  const options = useMemo(
    () => heroes.map((hero) => {
      const cc = s.getCharacter(hero.id);
      return {
        id: hero.id,
        name: hero.name,
        level: hero.level,
        statusLabel: getCharacterSelectStatusLabel(hero, cc.activity),
      };
    }),
    [heroes, s],
  );

  if (!dungeon) return null;

  const selectedCount = selectedIds.length;
  const validSelection = selectedCount >= minPartySize && selectedCount <= maxPartySize;
  const partyLimitLabel = formatPartyLimit(minPartySize, maxPartySize);

  return (
    <Modal
      isOpen={isOpen}
      title={`${dungeon.name} · ${T.dungeonPartyTitle}`}
      onClose={onClose}
      footer={(
        <>
          <button type="button" onClick={onClose} style={secondaryButtonStyle}>
            {T.btn_cancel}
          </button>
          <button
            type="button"
            disabled={!validSelection}
            onClick={() => {
              if (!validSelection) return;
              onConfirm(selectedIds);
            }}
            style={primaryButtonStyle(validSelection)}
          >
            {T.btn_enterDungeon}
          </button>
        </>
      )}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ fontSize: 12, lineHeight: 1.6, color: "#bbb" }}>
          <div style={{ fontWeight: 600, color: "#ddd" }}>{partyLimitLabel}</div>
          <div>{T.dungeonPartyHint}</div>
        </div>

        <CharacterSelectButtons
          options={options}
          selectedIds={selectedIds}
          mode="multiple"
          onChange={setSelectedIds}
        />

        <div style={summaryBoxStyle(validSelection)}>
          <div style={{ fontWeight: 600 }}>
            {fmt(T.dungeonPartySelected, { count: selectedCount })}
          </div>
          <div style={{ fontSize: 12, opacity: 0.8 }}>
            {validSelection ? partyLimitLabel : T.dungeonPartyInvalid}
          </div>
        </div>
      </div>
    </Modal>
  );
}

function formatPartyLimit(minPartySize: number, maxPartySize: number): string {
  if (minPartySize === maxPartySize) {
    return fmt(T.dungeonPartyLimitRange, {
      min: minPartySize,
      max: maxPartySize,
    });
  }
  return fmt(T.dungeonPartyLimitRange, {
    min: minPartySize,
    max: maxPartySize,
  });
}

const summaryBoxStyle = (validSelection: boolean): React.CSSProperties => ({
  padding: 10,
  borderRadius: 6,
  border: `1px solid ${validSelection ? "#355f49" : "#6a4a2a"}`,
  background: validSelection ? "#1d2b23" : "#2b2118",
  color: validSelection ? "#d9f3e6" : "#f0c674",
  display: "flex",
  flexDirection: "column",
  gap: 4,
});

const secondaryButtonStyle: React.CSSProperties = {
  padding: "6px 12px",
  borderRadius: 6,
  border: "1px solid #444",
  background: "#222",
  color: "#ddd",
  cursor: "pointer",
  fontFamily: "inherit",
};

function primaryButtonStyle(enabled: boolean): React.CSSProperties {
  return {
    padding: "6px 12px",
    borderRadius: 6,
    border: `1px solid ${enabled ? "#4a9" : "#444"}`,
    background: enabled ? "#244334" : "#222",
    color: enabled ? "#fff" : "#777",
    cursor: enabled ? "pointer" : "not-allowed",
    fontFamily: "inherit",
  };
}

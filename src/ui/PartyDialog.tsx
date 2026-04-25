// Party selection dialog — unified for combat zones and dungeons.
//
// Opens when the player clicks any combat or dungeon entry. Lets them choose
// which characters to send, then hands the selected ids back to the caller.
// For solo-friendly entries the dialog still shows (with the focused hero
// pre-selected) so the flow is consistent.

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

export type PartyDialogMode = "combat" | "dungeon";

export interface PartyDialogProps {
  store: GameStore;
  mode: PartyDialogMode;
  /** CombatZone id (mode=combat) or Dungeon id (mode=dungeon). */
  targetId: string | null;
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (partyCharIds: string[]) => void;
}

export function PartyDialog({
  store,
  mode,
  targetId,
  isOpen,
  onClose,
  onConfirm,
}: PartyDialogProps) {
  const { store: s } = useStore(store);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  const content = getContent();
  const dungeon = mode === "dungeon" && targetId ? content.dungeons[targetId] ?? null : null;
  const combatZone = mode === "combat" && targetId ? content.combatZones[targetId] ?? null : null;

  const heroes = s.listHeroes();
  const focusedHeroId = heroes.find((hero) => hero.id === s.focusedCharId)?.id ?? heroes[0]?.id ?? null;

  // Party size limits come from the target content def; combat zones now support them too.
  const minPartySize = dungeon?.minPartySize ?? combatZone?.minPartySize ?? 1;
  const maxPartySize = dungeon?.maxPartySize ?? combatZone?.maxPartySize ?? heroes.length;

  const entryName =
    dungeon?.name ??
    combatZone?.name ??
    targetId ??
    "";

  useEffect(() => {
    if (!isOpen) return;
    setSelectedIds(focusedHeroId ? [focusedHeroId] : []);
  }, [focusedHeroId, isOpen, targetId]);

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

  if (!targetId) return null;
  // For dungeons, require the dungeon def to exist.
  if (mode === "dungeon" && !dungeon) return null;

  const selectedCount = selectedIds.length;
  const validSelection = selectedCount >= minPartySize && selectedCount <= maxPartySize;
  const partyLimitLabel = formatPartyLimit(minPartySize, maxPartySize);

  const title = `${entryName} · ${T.partyDialogTitle}`;
  const confirmLabel = mode === "dungeon" ? T.btn_enterDungeon : T.btn_startCombat;
  const hint = mode === "dungeon" ? T.partyHintDungeon : T.partyHintCombat;

  return (
    <Modal
      isOpen={isOpen}
      title={title}
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
            {confirmLabel}
          </button>
        </>
      )}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ fontSize: 12, lineHeight: 1.6, color: "#bbb" }}>
          <div style={{ fontWeight: 600, color: "#ddd" }}>{partyLimitLabel}</div>
          <div>{hint}</div>
        </div>

        <CharacterSelectButtons
          options={options}
          selectedIds={selectedIds}
          mode="multiple"
          onChange={setSelectedIds}
        />

        <div style={summaryBoxStyle(validSelection)}>
          <div style={{ fontWeight: 600 }}>
            {fmt(T.partySelected, { count: selectedCount })}
          </div>
          <div style={{ fontSize: 12, opacity: 0.8 }}>
            {validSelection ? partyLimitLabel : T.partyInvalid}
          </div>
        </div>
      </div>
    </Modal>
  );
}

function formatPartyLimit(minPartySize: number, maxPartySize: number): string {
  return fmt(T.partyLimitRange, {
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

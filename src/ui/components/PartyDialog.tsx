// PartyDialog — unified party selection for combat zones and dungeons.

import { useEffect, useMemo, useState } from "react";
import { getContent } from "../../core/content";
import type { GameStore } from "../store";
import { useStore } from "../hooks/useStore";
import {
  CharacterSelectButtons,
  getCharacterSelectStatusLabel,
} from "./CharacterSelect";
import { Modal } from "./Modal";
import { T, fmt } from "../text";

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

  const minPartySize = dungeon?.minPartySize ?? combatZone?.minPartySize ?? 1;
  const maxPartySize = dungeon?.maxPartySize ?? combatZone?.maxPartySize ?? heroes.length;

  const entryName = dungeon?.name ?? combatZone?.name ?? targetId ?? "";

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
  if (mode === "dungeon" && !dungeon) return null;

  const selectedCount = selectedIds.length;
  const validSelection = selectedCount >= minPartySize && selectedCount <= maxPartySize;
  const partyLimitLabel = fmt(T.partyLimitRange, { min: minPartySize, max: maxPartySize });

  const title = `${entryName} \u00b7 ${T.partyDialogTitle}`;
  const confirmLabel = mode === "dungeon" ? T.btn_enterDungeon : T.btn_startCombat;
  const hint = mode === "dungeon" ? T.partyHintDungeon : T.partyHintCombat;

  return (
    <Modal
      isOpen={isOpen}
      title={title}
      onClose={onClose}
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 rounded-md border border-border bg-surface-light text-gray-300 cursor-pointer text-sm"
          >
            {T.btn_cancel}
          </button>
          <button
            type="button"
            disabled={!validSelection}
            onClick={() => {
              if (!validSelection) return;
              onConfirm(selectedIds);
            }}
            className={`px-3 py-1.5 rounded-md border text-sm
              ${validSelection
                ? "border-accent/50 bg-accent-dim text-white cursor-pointer"
                : "border-border bg-surface-light text-gray-600 cursor-not-allowed"}`}
          >
            {confirmLabel}
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <div className="text-[12px] leading-relaxed text-gray-400">
          <div className="font-semibold text-gray-300">{partyLimitLabel}</div>
          <div>{hint}</div>
        </div>

        <CharacterSelectButtons
          options={options}
          selectedIds={selectedIds}
          mode="multiple"
          onChange={setSelectedIds}
        />

        <div className={`p-2.5 rounded-md border flex flex-col gap-1
          ${validSelection
            ? "border-accent/30 bg-accent/5 text-green-200"
            : "border-gold/30 bg-yellow-900/10 text-gold"}`}
        >
          <div className="font-semibold text-[13px]">
            {fmt(T.partySelected, { count: selectedCount })}
          </div>
          <div className="text-[12px] opacity-80">
            {validSelection ? partyLimitLabel : T.partyInvalid}
          </div>
        </div>
      </div>
    </Modal>
  );
}

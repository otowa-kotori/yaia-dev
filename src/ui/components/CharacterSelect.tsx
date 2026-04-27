// Reusable character selection button group.
//
// Shared by the top character bar (single-select) and dungeon party setup
// (multi-select). The component stays presentation-focused: callers provide the
// display data and receive the next selected id list on click.

import type { PlayerCharacter } from "../../core/entity/actor";
import {
  ACTIVITY_COMBAT_KIND,
  ACTIVITY_GATHER_KIND,
  type CombatActivity,
  type GatherActivity,
} from "../../core/world/activity";
import { T } from "../text";

export interface CharacterSelectOption {
  id: string;
  name: string;
  level: number;
  statusLabel: string;
  disabled?: boolean;
  title?: string;
}

export interface CharacterSelectButtonsProps {
  options: CharacterSelectOption[];
  selectedIds: string[];
  mode: "single" | "multiple";
  onChange: (nextSelectedIds: string[]) => void;
}

export function CharacterSelectButtons({
  options,
  selectedIds,
  mode,
  onChange,
}: CharacterSelectButtonsProps) {
  return (
    <div className="flex gap-1.5 flex-nowrap">
      {options.map((option) => {
        const active = selectedIds.includes(option.id);
        const disabled = option.disabled ?? false;

        return (
          <button
            key={option.id}
            type="button"
            title={option.title}
            disabled={disabled}
            onClick={() => {
              if (disabled) return;
              if (mode === "single") {
                onChange([option.id]);
                return;
              }
              if (active) {
                onChange(selectedIds.filter((id) => id !== option.id));
                return;
              }
              onChange([...selectedIds, option.id]);
            }}
            className={`px-3 py-1.5 rounded-md text-xs flex flex-col items-start gap-0.5 min-w-[90px] cursor-pointer transition-colors
              ${active
                ? "border-2 border-accent/60 bg-accent/10 text-white"
                : "border border-border bg-surface-light text-gray-400 hover:border-border-light"
              }
              ${disabled ? "opacity-45 cursor-not-allowed" : ""}
            `}
          >
            <span className="font-semibold">{option.name}</span>
            <span className="text-[10px] opacity-65">
              Lv {option.level} · {option.statusLabel}
            </span>
          </button>
        );
      })}
    </div>
  );
}

export function getCharacterSelectStatusLabel(
  hero: PlayerCharacter,
  activity: CombatActivity | GatherActivity | null,
): string {
  if (hero.dungeonSessionId) return T.status_inDungeon;
  if (activity?.kind === ACTIVITY_COMBAT_KIND) return T.status_inCombat;
  if (activity?.kind === ACTIVITY_GATHER_KIND) return T.status_gathering;
  return T.status_idle;
}

// Reusable character selection button group.
//
// Shared by the top character bar (single-select) and dungeon party setup
// (multi-select). The component stays presentation-focused: callers provide the
// display data and receive the next selected id list on click.

import type { PlayerCharacter } from "../core/entity/actor";
import {
  ACTIVITY_COMBAT_KIND,
  ACTIVITY_GATHER_KIND,
  type CombatActivity,
  type GatherActivity,
} from "../core/world/activity";
import { T } from "./text";

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
    <div style={groupStyle}>
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
            style={buttonStyle(active, disabled)}
          >
            <span style={{ fontWeight: 600 }}>{option.name}</span>
            <span style={subLabelStyle}>
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

const groupStyle: React.CSSProperties = {
  display: "flex",
  gap: 6,
  flexWrap: "wrap",
};

const subLabelStyle: React.CSSProperties = {
  fontSize: 10,
  opacity: 0.65,
};

function buttonStyle(active: boolean, disabled: boolean): React.CSSProperties {
  return {
    padding: "6px 12px",
    fontSize: 12,
    borderRadius: 6,
    border: active ? "2px solid #4a9" : "1px solid #444",
    background: active ? "#2a3a2a" : "#222",
    color: active ? "#fff" : "#aaa",
    cursor: disabled ? "not-allowed" : active ? "default" : "pointer",
    fontFamily: "inherit",
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-start",
    gap: 2,
    minWidth: 90,
    opacity: disabled ? 0.45 : active ? 1 : 0.92,
  };
}

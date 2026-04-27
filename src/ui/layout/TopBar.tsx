// TopBar — horizontal bar above main content.
// Shows logo, character switcher, and version info.
// On mobile, the character buttons scroll horizontally if they overflow.

import type { GameStore } from "../store";
import { useStore } from "../hooks/useStore";
import {
  CharacterSelectButtons,
  getCharacterSelectStatusLabel,
} from "../components/CharacterSelect";
import { APP_VERSION, RELEASE_CHANNEL } from "../../env";

export function TopBar({ store }: { store: GameStore }) {
  const { store: s } = useStore(store);
  const heroes = s.listHeroes();
  const focusedId = s.focusedCharId;

  const channelLabel = RELEASE_CHANNEL === "dev" ? "dev" : "stable";

  const options = heroes.map((hero) => {
    const cc = s.getCharacter(hero.id);
    return {
      id: hero.id,
      name: hero.name,
      level: hero.level,
      statusLabel: getCharacterSelectStatusLabel(hero, cc.activity),
    };
  });

  return (
    <header className="h-12 bg-surface border-b border-border flex items-center px-3 lg:px-4 gap-2 shrink-0 min-w-0">
      {/* Logo */}
      <span className="text-accent font-semibold text-base shrink-0">YAIA</span>

      {/* Character switcher — scroll on mobile */}
      {heroes.length > 1 && (
        <div className="flex-1 min-w-0 overflow-x-auto scrollbar-hidden">
          <CharacterSelectButtons
            options={options}
            selectedIds={[focusedId]}
            mode="single"
            onChange={(ids) => {
              const next = ids[0];
              if (next) s.setFocusedChar(next);
            }}
          />
        </div>
      )}

      {heroes.length <= 1 && <div className="flex-1" />}

      <span className="text-[11px] text-gray-500 shrink-0 hidden sm:inline">
        {channelLabel} v{APP_VERSION}
      </span>
    </header>
  );
}

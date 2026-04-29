// LogEntry — single game-log line, coloured by category.

import type { GameLogEntry } from "../../core/infra/game-log";

const CATEGORY_COLORS: Record<string, string> = {
  world:     "text-green-400/70",
  activity:  "text-cyan-400/70",
  battle:    "text-red-400/70",
  reward:    "text-yellow-400/70",
  inventory: "text-purple-400/70",
  economy:   "text-amber-400/70",
  growth:    "text-blue-400/70",
  dungeon:   "text-orange-400/70",
};

export function LogEntry({ entry }: { entry: GameLogEntry }) {
  const catClass = CATEGORY_COLORS[entry.category] ?? "text-gray-500";
  return (
    <div className="text-[11px] leading-relaxed">
      <span className={catClass}>[{entry.category}]</span>{" "}
      <span className="text-gray-400">{entry.text}</span>
    </div>
  );
}

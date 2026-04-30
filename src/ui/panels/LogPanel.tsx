// LogPanel — persistent activity log panel for the desktop right sidebar.
//
// Renders a scrollable list of game log entries using the LogEntry component.
// Exported as `ActivityLogPanel` for backward compatibility with existing imports.

import { useEffect, useRef } from "react";
import type { GameLogCategory, GameLogEntry } from "../../core/infra/game-log";
import { LogEntry } from "../components/LogEntry";
import { T } from "../text";

export interface LogPanelProps {
  entries: GameLogEntry[];
  emptyMessage?: string;
  limit?: number;
}

/**
 * Standalone log panel — used in the desktop sidebar and as an inline embed.
 * Exported as `ActivityLogPanel` for backward compatibility.
 */
export function ActivityLogPanel({
  entries,
  emptyMessage = T.activityLogEmpty,
  limit = 8,
}: LogPanelProps) {
  const listRef = useRef<HTMLDivElement | null>(null);
  const shouldStickToBottomRef = useRef(true);
  const tail = entries.slice(-limit);

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    if (!shouldStickToBottomRef.current) return;
    el.scrollTop = el.scrollHeight;
  }, [tail.length]);

  function handleScroll() {
    const el = listRef.current;
    if (!el) return;
    const distanceToBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    shouldStickToBottomRef.current = distanceToBottom <= 24;
  }

  if (tail.length === 0) {
    return (
      <div className="h-full p-2.5 bg-surface-lighter rounded-md text-xs opacity-70">
        {emptyMessage}
      </div>
    );
  }

  return (
    <div
      ref={listRef}
      onScroll={handleScroll}
      className="h-full p-2 bg-black/40 rounded-md text-xs overflow-y-auto flex flex-col gap-1.5"
    >
      {tail.map((entry, index) => (
        <LogEntry key={`${entry.tick}:${index}:${entry.text}`} entry={entry} />
      ))}
    </div>
  );
}

// ============================================================
// Helpers
// ============================================================

export function categoryLabel(category: GameLogCategory): string {
  switch (category) {
    case "world":
      return T.logCategory_world;
    case "activity":
      return T.logCategory_activity;
    case "battle":
      return T.logCategory_battle;
    case "reward":
      return T.logCategory_reward;
    case "inventory":
      return T.logCategory_inventory;
    case "economy":
      return T.logCategory_economy;
    case "growth":
      return T.logCategory_growth;
    case "dungeon":
      return T.logCategory_dungeon;
    case "quest":
      return T.logCategory_quest;
  }
}

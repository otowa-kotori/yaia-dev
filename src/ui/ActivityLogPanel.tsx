import type { GameLogCategory, GameLogEntry } from "../core/infra/game-log";
import { T } from "./text";

export function ActivityLogPanel({
  entries,
  emptyMessage = T.activityLogEmpty,
  limit = 8,
}: {
  entries: GameLogEntry[];
  emptyMessage?: string;
  limit?: number;
}) {
  const tail = entries.slice(-limit);

  if (tail.length === 0) {
    return <div style={emptyStyle}>{emptyMessage}</div>;
  }

  return (
    <div style={panelStyle}>
      {tail.map((entry, index) => (
        <div key={`${entry.tick}:${index}:${entry.text}`} style={rowStyle}>
          <span style={tickStyle}>[{String(entry.tick).padStart(4, "0")}]</span>
          <span style={categoryStyle(entry.category)}>{categoryLabel(entry.category)}</span>
          <span style={{ flex: 1 }}>{entry.text}</span>
        </div>
      ))}
    </div>
  );
}

function categoryLabel(category: GameLogCategory): string {
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
  }
}

function categoryStyle(category: GameLogCategory): React.CSSProperties {
  const color =
    category === "battle"
      ? "#58A6FF"
      : category === "reward" || category === "growth"
        ? "#3FB950"
        : category === "economy"
          ? "#F0C674"
          : category === "inventory"
            ? "#c586ff"
            : category === "dungeon"
              ? "#ff7b72"
              : "#8B949E";
  return {
    color,
    border: `1px solid ${color}`,
    borderRadius: 999,
    padding: "1px 6px",
    fontSize: 11,
    lineHeight: 1.5,
    whiteSpace: "nowrap",
    alignSelf: "flex-start",
  };
}

const panelStyle: React.CSSProperties = {
  marginTop: 12,
  padding: 8,
  background: "#111",
  borderRadius: 6,
  fontSize: 12,
  maxHeight: 220,
  overflow: "auto",
  display: "flex",
  flexDirection: "column",
  gap: 6,
};

const rowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "flex-start",
  gap: 8,
  lineHeight: 1.5,
  opacity: 0.92,
};

const tickStyle: React.CSSProperties = {
  fontVariantNumeric: "tabular-nums",
  opacity: 0.6,
  whiteSpace: "nowrap",
};

const emptyStyle: React.CSSProperties = {
  marginTop: 12,
  padding: 10,
  background: "#222",
  borderRadius: 6,
  fontSize: 12,
  opacity: 0.7,
};

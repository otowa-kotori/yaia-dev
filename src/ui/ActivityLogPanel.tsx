import type { BattleLogEntry } from "../core/combat/battle/battle";
import { T } from "./text";

export function ActivityLogPanel({
  log,
  emptyMessage = T.activityLogEmpty,
}: {
  log: BattleLogEntry[];
  emptyMessage?: string;
}) {
  const tail = log.slice(-8);

  if (tail.length === 0) {
    return <div style={emptyStyle}>{emptyMessage}</div>;
  }

  return (
    <div style={panelStyle}>
      {tail.map((entry, index) => (
        <div key={`${entry.tick}:${index}`} style={{ opacity: 0.9 }}>
          [{String(entry.tick).padStart(4, "0")}] {entry.kind}
          {entry.actorId ? ` · ${entry.actorId}` : ""}
          {entry.targetIds?.length ? ` → ${entry.targetIds.join(",")}` : ""}
          {entry.abilityId ? ` · ${entry.abilityId}` : ""}
          {entry.magnitudes?.length ? ` (${entry.magnitudes.join(",")})` : ""}
          {entry.note ? ` · ${entry.note}` : ""}
        </div>
      ))}
    </div>
  );
}

const panelStyle: React.CSSProperties = {
  marginTop: 12,
  padding: 8,
  background: "#111",
  borderRadius: 4,
  fontSize: 12,
  fontFamily: "ui-monospace, Menlo, monospace",
  maxHeight: 180,
  overflow: "auto",
};

const emptyStyle: React.CSSProperties = {
  marginTop: 12,
  padding: 10,
  background: "#222",
  borderRadius: 6,
  fontSize: 12,
  opacity: 0.7,
};

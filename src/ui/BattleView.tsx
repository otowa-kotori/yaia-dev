// Battle view: lists participants with HP bars + tail of battle log.
// Purely presentational — reads from Store, dispatches nothing.

import type { Character } from "../core/actor";
import { getAttr, isCharacter } from "../core/actor";
import { buildDefaultContent } from "../content";
import type { GameStore } from "./store";
import { useStore } from "./useStore";

// Cache the content attr defs once; UI only needs read access.
const ATTR_DEFS = buildDefaultContent().attributes;

export function BattleView({ store }: { store: GameStore }) {
  const { store: s } = useStore(store);
  const battle = s.battle;

  if (!battle) {
    return (
      <div style={{ opacity: 0.6, fontSize: 14 }}>
        No active battle. Click "start battle" to begin.
      </div>
    );
  }

  const participants = battle.participantIds
    .map((id) => s.state.actors.find((a) => a.id === id))
    .filter((a): a is Character => a !== undefined && isCharacter(a));

  const players = participants.filter((p) => p.kind === "player");
  const enemies = participants.filter((p) => p.kind === "enemy");

  return (
    <div>
      <div style={{ display: "flex", gap: 24, marginBottom: 16 }}>
        <Column title="Players" actors={players} />
        <Column title="Enemies" actors={enemies} />
      </div>
      <OutcomeBadge outcome={battle.outcome} />
      <LogTail log={battle.log} />
    </div>
  );
}

function Column({ title, actors }: { title: string; actors: Character[] }) {
  return (
    <div style={{ flex: 1, minWidth: 0 }}>
      <div style={{ fontSize: 12, opacity: 0.6, marginBottom: 4 }}>{title}</div>
      {actors.map((a) => (
        <ActorRow key={a.id} actor={a} />
      ))}
    </div>
  );
}

function ActorRow({ actor }: { actor: Character }) {
  const maxHp = Math.max(1, getAttr(actor, "attr.max_hp", ATTR_DEFS));
  const hpPct = Math.max(0, Math.min(1, actor.currentHp / maxHp));
  const dead = actor.currentHp <= 0;
  return (
    <div
      style={{
        marginBottom: 8,
        padding: 8,
        background: "#222",
        borderRadius: 4,
        opacity: dead ? 0.35 : 1,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between" }}>
        <span style={{ fontWeight: 600 }}>
          {actor.name}
          {dead ? " (KO)" : ""}
        </span>
        <span style={{ fontVariantNumeric: "tabular-nums", fontSize: 13 }}>
          {Math.round(actor.currentHp)} / {Math.round(maxHp)}
        </span>
      </div>
      <div
        style={{
          marginTop: 4,
          height: 8,
          background: "#111",
          borderRadius: 2,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            height: "100%",
            width: `${hpPct * 100}%`,
            background: actor.kind === "player" ? "#4a7" : "#c44",
            transition: "width 100ms linear",
          }}
        />
      </div>
    </div>
  );
}

function OutcomeBadge({ outcome }: { outcome: string }) {
  if (outcome === "ongoing") return null;
  const colors: Record<string, string> = {
    players_won: "#4a7",
    enemies_won: "#c44",
    draw: "#aa4",
  };
  return (
    <div
      style={{
        display: "inline-block",
        padding: "4px 10px",
        marginBottom: 8,
        background: colors[outcome] ?? "#666",
        color: "#111",
        fontSize: 12,
        fontWeight: 600,
        borderRadius: 4,
      }}
    >
      {outcome.replace("_", " ")}
    </div>
  );
}

function LogTail({ log }: { log: { tick: number; kind: string; actorId?: string; abilityId?: string; magnitudes?: number[]; note?: string }[] }) {
  const tail = log.slice(-8);
  return (
    <div
      style={{
        marginTop: 8,
        padding: 8,
        background: "#111",
        borderRadius: 4,
        fontSize: 12,
        fontFamily: "ui-monospace, Menlo, monospace",
        maxHeight: 200,
        overflow: "auto",
      }}
    >
      {tail.map((e, i) => (
        <div key={i} style={{ opacity: 0.9 }}>
          [{String(e.tick).padStart(4, "0")}] {e.kind}
          {e.actorId ? ` · ${e.actorId}` : ""}
          {e.abilityId ? ` → ${e.abilityId}` : ""}
          {e.magnitudes?.length ? ` (${e.magnitudes.join(",")})` : ""}
          {e.note ? ` · ${e.note}` : ""}
        </div>
      ))}
    </div>
  );
}

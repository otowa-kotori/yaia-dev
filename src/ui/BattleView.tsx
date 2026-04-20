// Battle view: lists participants with HP bars + tail of battle log.
// Purely presentational — reads from Store, dispatches nothing.

import type { Character, PlayerCharacter } from "../core/actor";
import { getAttr, isCharacter, isPlayer } from "../core/actor";
import { xpProgressToNextLevel } from "../core/progression";
import { buildDefaultContent } from "../content";
import type { GameStore } from "./store";
import { useStore } from "./useStore";

const ATTR_DEFS = buildDefaultContent().attributes;

export function BattleView({ store }: { store: GameStore }) {
  const { store: s } = useStore(store);
  const activity = s.activity;
  const hero = s.getHero();

  // Always show hero (so XP/level is visible even when idle).
  const heroRow = hero ? <HeroCard hero={hero} activity={activity} /> : null;

  if (!activity || !activity.currentBattle) {
    return (
      <div>
        {heroRow}
        <div style={{ opacity: 0.6, fontSize: 14, marginTop: 12 }}>
          {activity && activity.phase === "recovering"
            ? "Recovering from defeat..."
            : activity && activity.phase === "waveDelay"
            ? "Next wave incoming..."
            : 'Idle. Click "start grinding" to begin.'}
        </div>
      </div>
    );
  }

  const battle = activity.currentBattle;
  const participants = battle.participantIds
    .map((id) => s.state.actors.find((a) => a.id === id))
    .filter((a): a is Character => a !== undefined && isCharacter(a));
  const enemies = participants.filter((p) => !isPlayer(p));

  return (
    <div>
      {heroRow}
      <div style={{ marginTop: 12 }}>
        <div style={{ fontSize: 12, opacity: 0.6, marginBottom: 4 }}>
          Wave {activity.waveIndex} — Enemies
        </div>
        {enemies.map((a) => (
          <ActorRow key={a.id} actor={a} />
        ))}
      </div>
      <LogTail log={battle.log} />
    </div>
  );
}

function HeroCard({
  hero,
  activity,
}: {
  hero: PlayerCharacter;
  activity: GameStore["activity"];
}) {
  const maxHp = Math.max(1, getAttr(hero, "attr.max_hp", ATTR_DEFS));
  const hpPct = Math.max(0, Math.min(1, hero.currentHp / maxHp));
  const dead = hero.currentHp <= 0;
  const xp = xpProgressToNextLevel(hero.level, hero.exp, hero.xpCurve);

  const statusLabel =
    activity?.phase === "recovering"
      ? "recovering"
      : activity?.phase === "waveDelay"
      ? "next wave..."
      : activity?.phase === "fighting"
      ? "in combat"
      : "idle";

  return (
    <div
      style={{
        padding: 10,
        background: "#222",
        borderRadius: 4,
        opacity: dead ? 0.45 : 1,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between" }}>
        <span style={{ fontWeight: 600 }}>
          {hero.name} · Lv {hero.level}
          {dead ? " (KO)" : ""}
        </span>
        <span style={{ fontSize: 12, opacity: 0.7 }}>{statusLabel}</span>
      </div>
      <div style={{ display: "flex", gap: 12, alignItems: "center", marginTop: 6 }}>
        <div style={{ flex: 1 }}>
          <Bar pct={hpPct} color="#4a7" />
          <div style={{ fontSize: 11, marginTop: 2, opacity: 0.7, fontVariantNumeric: "tabular-nums" }}>
            HP {Math.round(hero.currentHp)} / {Math.round(maxHp)}
          </div>
        </div>
        <div style={{ flex: 1 }}>
          <Bar pct={xp.pct} color="#59c" />
          <div style={{ fontSize: 11, marginTop: 2, opacity: 0.7, fontVariantNumeric: "tabular-nums" }}>
            XP {hero.exp} / {xp.cost || "—"}
          </div>
        </div>
      </div>
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
        marginBottom: 6,
        padding: 8,
        background: "#222",
        borderRadius: 4,
        opacity: dead ? 0.35 : 1,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between" }}>
        <span style={{ fontWeight: 500 }}>
          {actor.name}
          {dead ? " (KO)" : ""}
        </span>
        <span style={{ fontVariantNumeric: "tabular-nums", fontSize: 12 }}>
          {Math.round(actor.currentHp)} / {Math.round(maxHp)}
        </span>
      </div>
      <div style={{ marginTop: 4 }}>
        <Bar pct={hpPct} color="#c44" />
      </div>
    </div>
  );
}

function Bar({ pct, color }: { pct: number; color: string }) {
  return (
    <div
      style={{
        height: 6,
        background: "#111",
        borderRadius: 2,
        overflow: "hidden",
      }}
    >
      <div
        style={{
          height: "100%",
          width: `${pct * 100}%`,
          background: color,
          transition: "width 100ms linear",
        }}
      />
    </div>
  );
}

function LogTail({
  log,
}: {
  log: {
    tick: number;
    kind: string;
    actorId?: string;
    abilityId?: string;
    magnitudes?: number[];
    note?: string;
  }[];
}) {
  const tail = log.slice(-8);
  return (
    <div
      style={{
        marginTop: 12,
        padding: 8,
        background: "#111",
        borderRadius: 4,
        fontSize: 12,
        fontFamily: "ui-monospace, Menlo, monospace",
        maxHeight: 180,
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

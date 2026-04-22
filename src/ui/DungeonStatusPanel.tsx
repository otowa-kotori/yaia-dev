// Dungeon status panel — focused presentation for the active dungeon run.
//
// Reads directly from existing store/session state without introducing new
// session APIs. The panel summarizes wave progress, inferred phase, party HP,
// current enemies, and exposes the abandon action.

import type { Actor, Character, PlayerCharacter } from "../core/actor";
import { getAttr, isEnemy, isPlayer } from "../core/actor";
import { ACTIVITY_DUNGEON_KIND, type DungeonPhase } from "../core/activity";
import { ATTR } from "../core/attribute";
import type { Battle } from "../core/combat/battle";
import { getContent } from "../core/content";
import type { DungeonSession } from "../core/state";
import type { StageSession } from "../core/stage/types";
import { buildDefaultContent } from "../content";
import { ActivityLogPanel } from "./ActivityLogPanel";
import type { GameStore } from "./store";
import { T, fmt } from "./text";


const ATTR_DEFS = buildDefaultContent().attributes;

export function DungeonStatusPanel({
  store,
  dungeonSessionId,
  heroId,
}: {
  store: GameStore;
  dungeonSessionId: string;
  heroId: string;
}) {
  const session = store.state.dungeons[dungeonSessionId];
  if (!session) return null;

  const dungeon = getContent().dungeons[session.dungeonId] ?? null;
  const stage = store.state.stages[session.stageId] ?? null;
  const party = getPartyMembers(store, session);
  const phase = inferDungeonPhase(session, stage, party);
  const phaseLabel = getDungeonPhaseLabel(phase);
  const enemies = getDungeonEnemies(store, stage);
  const activeBattle = getActiveDungeonBattle(store, session);
  const totalWaves = dungeon?.waves.length ?? Math.max(1, session.currentWaveIndex + 1);

  const currentWave = Math.min(totalWaves, session.currentWaveIndex + 1);

  return (
    <div style={panelStyle}>
      <div style={headerStyle}>
        <div>
          <div style={eyebrowStyle}>{T.dungeonPanelTitle}</div>
          <div style={titleStyle}>{dungeon?.name ?? session.dungeonId}</div>
        </div>
        <div style={phaseBadgeStyle(phase)}>{phaseLabel}</div>
      </div>

      <div style={summaryGridStyle}>
        <SummaryItem label={T.dungeonCurrentWave} value={fmt(T.dungeonProgress, { current: currentWave, total: totalWaves })} />
        <SummaryItem label={T.dungeonPhaseLabel} value={phaseLabel} />
      </div>

      <Section title={T.dungeonPartyLabel}>
        {party.length > 0 ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {party.map((hero) => (
              <ParticipantRow key={hero.id} actor={hero} />
            ))}
          </div>
        ) : (
          <EmptyHint message={T.dungeonNoParty} />
        )}
      </Section>

      <Section title={T.dungeonEnemyLabel}>
        {enemies.length > 0 ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {enemies.map((enemy) => (
              <ParticipantRow key={enemy.id} actor={enemy} />
            ))}
          </div>
        ) : (
          <EmptyHint message={T.dungeonNoEnemy} />
        )}
      </Section>

      <Section title={T.activityLogTitle}>
        <ActivityLogPanel
          log={activeBattle?.log ?? []}
          emptyMessage={T.dungeonNoLog}
        />
      </Section>

      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 12 }}>

        <button
          type="button"
          onClick={() => {
            if (confirm(T.confirmAbandonDungeon)) {
              store.abandonDungeon(heroId);
            }
          }}
          style={dangerButtonStyle}
        >
          {T.btn_abandonDungeon}
        </button>
      </div>
    </div>
  );
}

export function getCharacterDungeonStatusLabel(
  hero: PlayerCharacter,
  store: GameStore,
): string | null {
  if (!hero.dungeonSessionId || hero.activity?.kind !== ACTIVITY_DUNGEON_KIND) {
    return null;
  }

  const session = store.state.dungeons[hero.dungeonSessionId] ?? null;
  const stage = hero.stageId ? store.state.stages[hero.stageId] ?? null : null;
  const party = session ? getPartyMembers(store, session) : [];
  const phase = session ? inferDungeonPhase(session, stage, party) : null;

  if (phase === "fighting") return T.status_hero_inCombat;
  if (phase === "recovering") return T.status_hero_recovering;
  return T.status_hero_dungeon;
}

function getPartyMembers(store: GameStore, session: DungeonSession): PlayerCharacter[] {
  return session.partyCharIds
    .map((charId) => store.state.actors.find((actor) => actor.id === charId))
    .filter((actor): actor is PlayerCharacter => actor !== undefined && isPlayer(actor));
}

function getDungeonEnemies(store: GameStore, stage: StageSession | null): Character[] {
  if (!stage) return [];

  const candidateIds = stage.currentWave?.enemyIds?.length
    ? stage.currentWave.enemyIds
    : stage.spawnedActorIds;

  return candidateIds
    .map((id) => store.state.actors.find((actor) => actor.id === id))
    .filter((actor): actor is Character => actor !== undefined && isEnemy(actor));
}

function getActiveDungeonBattle(
  store: GameStore,
  session: DungeonSession,
): Battle | null {
  const partyIds = new Set(session.partyCharIds);
  return (
    store.state.battles.find(
      (battle) =>
        battle.outcome === "ongoing" &&
        battle.participantIds.some((participantId) => partyIds.has(participantId)),
    ) ?? null
  );
}

function inferDungeonPhase(

  session: DungeonSession,
  stage: StageSession | null,
  party: PlayerCharacter[],
): DungeonPhase {
  if (session.status !== "in_progress") {
    return session.status;
  }
  if (stage?.currentWave?.status === "active") return "fighting";
  if (stage?.currentWave?.status === "victory") return "waveCleared";
  if (stage?.currentWave?.status === "defeat") return "failed";
  if (session.currentWaveIndex > 0 && party.some((hero) => !isAtFullHp(hero))) {
    return "recovering";
  }
  return "spawningWave";
}

function getDungeonPhaseLabel(phase: DungeonPhase): string {
  switch (phase) {
    case "spawningWave":
      return T.dungeonPhase_spawningWave;
    case "fighting":
      return T.dungeonPhase_fighting;
    case "waveCleared":
      return T.dungeonPhase_waveCleared;
    case "recovering":
      return T.dungeonPhase_recovering;
    case "completed":
      return T.dungeonPhase_completed;
    case "failed":
      return T.dungeonPhase_failed;
    case "abandoned":
      return T.dungeonPhase_abandoned;
  }
}

function isAtFullHp(actor: Character): boolean {
  const maxHp = Math.max(1, getAttr(actor, ATTR.MAX_HP, ATTR_DEFS));
  return actor.currentHp >= maxHp;
}

function SummaryItem({ label, value }: { label: string; value: string }) {
  return (
    <div style={summaryCardStyle}>
      <div style={summaryLabelStyle}>{label}</div>
      <div style={summaryValueStyle}>{value}</div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginTop: 14 }}>
      <div style={sectionTitleStyle}>{title}</div>
      {children}
    </div>
  );
}

function EmptyHint({ message }: { message: string }) {
  return <div style={emptyHintStyle}>{message}</div>;
}

function ParticipantRow({ actor }: { actor: Character }) {
  const maxHp = Math.max(1, getAttr(actor, ATTR.MAX_HP, ATTR_DEFS));
  const hpPct = Math.max(0, Math.min(1, actor.currentHp / maxHp));
  const dead = actor.currentHp <= 0;

  return (
    <div style={participantRowStyle(dead)}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
        <span style={{ fontWeight: 600 }}>
          {actor.name}
          {dead ? ` (${T.ko})` : ""}
        </span>
        <span style={numbersStyle}>
          {Math.round(actor.currentHp)} / {Math.round(maxHp)}
        </span>
      </div>
      <div style={{ marginTop: 6 }}>
        <Bar pct={hpPct} color={isPlayer(actor) ? "#4a9" : "#c44"} />
      </div>
    </div>
  );
}

function Bar({ pct, color }: { pct: number; color: string }) {
  return (
    <div style={barTrackStyle}>
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

const panelStyle: React.CSSProperties = {
  marginTop: 12,
  padding: 12,
  background: "#1d1f22",
  borderRadius: 6,
  border: "1px solid #333",
};

const headerStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  gap: 12,
  alignItems: "flex-start",
};

const eyebrowStyle: React.CSSProperties = {
  fontSize: 11,
  opacity: 0.6,
  textTransform: "uppercase",
  letterSpacing: 0.4,
};

const titleStyle: React.CSSProperties = {
  marginTop: 4,
  fontSize: 18,
  fontWeight: 700,
  color: "#fff",
};

const summaryGridStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
  gap: 8,
  marginTop: 12,
};

const summaryCardStyle: React.CSSProperties = {
  padding: 10,
  borderRadius: 6,
  background: "#222",
  border: "1px solid #2f2f2f",
};

const summaryLabelStyle: React.CSSProperties = {
  fontSize: 11,
  opacity: 0.65,
};

const summaryValueStyle: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 600,
  marginTop: 4,
};

const sectionTitleStyle: React.CSSProperties = {
  fontSize: 12,
  opacity: 0.7,
  marginBottom: 6,
};

const emptyHintStyle: React.CSSProperties = {
  padding: 10,
  background: "#222",
  borderRadius: 6,
  fontSize: 12,
  opacity: 0.7,
};

const numbersStyle: React.CSSProperties = {
  fontSize: 12,
  fontVariantNumeric: "tabular-nums",
  opacity: 0.8,
};

const barTrackStyle: React.CSSProperties = {
  height: 6,
  background: "#111",
  borderRadius: 3,
  overflow: "hidden",
};

const dangerButtonStyle: React.CSSProperties = {
  padding: "6px 12px",
  borderRadius: 6,
  border: "1px solid #733",
  background: "#2b1919",
  color: "#f0b0b0",
  cursor: "pointer",
  fontFamily: "inherit",
};

function phaseBadgeStyle(phase: DungeonPhase): React.CSSProperties {
  const color =
    phase === "fighting"
      ? "#58A6FF"
      : phase === "recovering"
      ? "#F0C674"
      : phase === "waveCleared"
      ? "#3FB950"
      : phase === "failed" || phase === "abandoned"
      ? "#F85149"
      : "#8B949E";

  return {
    padding: "4px 8px",
    borderRadius: 999,
    border: `1px solid ${color}`,
    color,
    fontSize: 12,
    fontWeight: 600,
    whiteSpace: "nowrap",
  };
}

function participantRowStyle(dead: boolean): React.CSSProperties {
  return {
    padding: 8,
    background: "#222",
    borderRadius: 6,
    opacity: dead ? 0.45 : 1,
  };
}

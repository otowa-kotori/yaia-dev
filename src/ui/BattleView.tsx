// Scene view — the main "what's happening right now" panel.
//
// Layout (unified for solo combat, party combat, and dungeon):
//   ┌─ phase badge ──────────────────────────────────────────┐
//   │ 队伍                                                    │
//   │   HeroCard (name · Lv · HP bar · ATB bar · XP bar)     │
//   │   HeroCard …                                            │
//   │ 敌人                                                    │
//   │   ActorCard (enemy, compact)                            │
//   │   ActorCard …                                           │
//   │ 战斗日志                                                │
//   └────────────────────────────────────────────────────────┘
//
// When idle / gathering, the focused hero's HeroCard is shown at the top
// as before (no panel wrapper).
//
// Pure presentation — reads from Store, dispatches nothing.

import type { PlayerCharacter } from "../core/entity/actor";
import { isCharacter, isEnemy, isPlayer, isResourceNode } from "../core/entity/actor";
import { xpProgressToNextLevel } from "../core/growth/leveling";
import {
  ACTIVITY_COMBAT_KIND,
  ACTIVITY_GATHER_KIND,
  ACTIVITY_DUNGEON_KIND,
  type CombatActivity,
  type GatherActivity,
} from "../core/world/activity";
import type { GameStore } from "./store";
import { useStore } from "./useStore";
import { T, fmt } from "./text";
import { PendingLootPanel } from "./PendingLootPanel";
import { ActivityLogPanel } from "./ActivityLogPanel";
import { ActorCard } from "./ActorCard";
import type { Battle } from "../core/combat/battle/battle";
import { getAtbGaugePct } from "../core/combat/battle/scheduler";
import { getContent } from "../core/content";
import type { DungeonSession } from "../core/infra/state/types";
import type { StageSession } from "../core/world/stage/types";

export function BattleView({ store }: { store: GameStore }) {
  const { store: s } = useStore(store);
  const cc = s.getFocusedCharacter();
  const activity = cc.activity;
  const hero = cc.hero;
  const pendingLoot = cc.stageSession?.pendingLoot ?? [];

  const lootPanel = pendingLoot.length > 0
    ? <PendingLootPanel cc={cc} pendingLoot={pendingLoot} />
    : null;

  // ── No location ──
  if (!hero.locationId) {
    return (
      <div>
        <HeroCard hero={hero} />
        <Idle msg={T.pickLocation} />
      </div>
    );
  }

  // ── Dungeon ──
  if (hero.dungeonSessionId) {
    const ds = s.state.dungeons[hero.dungeonSessionId];
    if (ds) {
      return (
        <div>
          {lootPanel}
          <DungeonCombatPanel store={s} dungeonSession={ds} heroId={hero.id} />
        </div>
      );
    }
  }

  // ── Combat (solo or party) ──
  if (activity?.kind === ACTIVITY_COMBAT_KIND) {
    const combatAct = activity as CombatActivity;
    const battle = findCurrentBattle(combatAct, s);
    return (
      <div>
        {lootPanel}
        <CombatPanel activity={combatAct} store={s} battle={battle} />
      </div>
    );
  }

  // ── Gather ──
  if (activity?.kind === ACTIVITY_GATHER_KIND) {
    return (
      <div>
        <HeroCard hero={hero} statusOverride={T.status_hero_gathering} />
        {lootPanel}
        <GatherPanel activity={activity} store={s} />
      </div>
    );
  }

  // ── Idle in a location ──
  return (
    <div>
      <HeroCard hero={hero} />
      {lootPanel}
      <StageRoster store={s} />
    </div>
  );
}

// ============================================================
// Unified combat panel — used for both solo and party combat
// ============================================================

function CombatPanel({
  activity,
  store,
  battle,
}: {
  activity: CombatActivity;
  store: GameStore;
  battle: Battle | null;
}) {
  const phaseLabel = combatPhaseLabel(activity.phase);

  const partyHeroes = activity.partyCharIds
    .map((id) => store.state.actors.find((a) => a.id === id))
    .filter((a): a is PlayerCharacter => a !== undefined && isPlayer(a));

  if (!battle) {
    return (
      <div style={panelStyle}>
        <PanelHeader phaseLabel={phaseLabel} />
        <SectionTitle>{T.combatPartyLabel}</SectionTitle>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {partyHeroes.map((h) => (
            <HeroCard key={h.id} hero={h} statusOverride={phaseLabel} />
          ))}
        </div>
        <StageRoster store={store} />
      </div>
    );
  }

  const enemies = battle.participantIds
    .map((id) => store.state.actors.find((a) => a.id === id))
    .filter((a) => a !== undefined && isCharacter(a) && isEnemy(a));

  return (
    <div style={panelStyle}>
      <PanelHeader phaseLabel={phaseLabel} />

      <SectionTitle>{T.combatPartyLabel}</SectionTitle>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {partyHeroes.map((h) => (
          <HeroCard key={h.id} hero={h} battle={battle} statusOverride={phaseLabel} />
        ))}
      </div>

      <SectionTitle>{T.enemies}</SectionTitle>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {enemies.map((a) => (
          <ActorCard
            key={a.id}
            actor={a}
            variant="enemy"
            atbPct={getAtbPct(battle, a.id)}
          />
        ))}
      </div>

      <ActivityLogPanel log={battle.log} />
    </div>
  );
}

// ============================================================
// Dungeon panel — reuses the same layout structure
// ============================================================

function DungeonCombatPanel({
  store,
  dungeonSession: ds,
  heroId,
}: {
  store: GameStore;
  dungeonSession: DungeonSession;
  heroId: string;
}) {
  const dungeon = getContent().dungeons[ds.dungeonId] ?? null;
  const stage: StageSession | null = store.state.stages[ds.stageId] ?? null;

  const partyHeroes = ds.partyCharIds
    .map((id) => store.state.actors.find((a) => a.id === id))
    .filter((a): a is PlayerCharacter => a !== undefined && isPlayer(a));

  const phase = inferDungeonPhase(ds, stage, partyHeroes);
  const phaseLabel = dungeonPhaseLabel(phase);

  const enemies = stage
    ? (stage.currentWave?.enemyIds ?? stage.spawnedActorIds)
        .map((id) => store.state.actors.find((a) => a.id === id))
        .filter((a) => a !== undefined && isCharacter(a) && isEnemy(a))
    : [];

  const activeBattle = store.state.battles.find((b) => {
    if (b.outcome !== "ongoing") return false;
    const partyIds = new Set(ds.partyCharIds);
    return b.participantIds.some((pid) => partyIds.has(pid));
  }) ?? null;

  const totalWaves = dungeon?.waves.length ?? Math.max(1, ds.currentWaveIndex + 1);
  const currentWave = Math.min(totalWaves, ds.currentWaveIndex + 1);

  return (
    <div style={panelStyle}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
        <div>
          <div style={{ fontSize: 11, opacity: 0.6, textTransform: "uppercase", letterSpacing: 0.4 }}>
            {T.dungeonPanelTitle}
          </div>
          <div style={{ marginTop: 4, fontSize: 18, fontWeight: 700, color: "#fff" }}>
            {dungeon?.name ?? ds.dungeonId}
          </div>
        </div>
        <PhaseBadge label={phaseLabel} phase={phase} />
      </div>

      <div style={{ fontSize: 12, opacity: 0.7, marginTop: 8 }}>
        {fmt(T.dungeonProgress, { current: currentWave, total: totalWaves })}
      </div>

      <SectionTitle>{T.combatPartyLabel}</SectionTitle>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {partyHeroes.map((h) => (
          <HeroCard key={h.id} hero={h} battle={activeBattle} statusOverride={phaseLabel} />
        ))}
      </div>

      {enemies.length > 0 && (
        <>
          <SectionTitle>{T.enemies}</SectionTitle>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {enemies.map((a) => (
              <ActorCard key={a.id} actor={a} variant="enemy"
                atbPct={activeBattle ? getAtbPct(activeBattle, a.id) : undefined} />
            ))}
          </div>
        </>
      )}

      <ActivityLogPanel
        log={activeBattle?.log ?? []}
        emptyMessage={T.dungeonNoLog}
      />

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

// ============================================================
// HeroCard — the primary hero display with HP, ATB, XP
// ============================================================

function HeroCard({
  hero,
  battle,
  statusOverride,
}: {
  hero: PlayerCharacter;
  battle?: Battle | null;
  statusOverride?: string;
}) {
  const xp = xpProgressToNextLevel(hero.level, hero.exp, hero.xpCurve);
  const statusLabel = statusOverride ?? T.status_hero_idle;
  const inBattle = battle && battle.outcome === "ongoing";

  return (
    <ActorCard
      actor={hero}
      variant="hero"
      statusLabel={`Lv ${hero.level} · ${statusLabel}`}
      atbPct={inBattle ? getAtbPct(battle, hero.id) : undefined}
    >
      <div style={{ marginTop: 3 }}>
        <div style={{ height: 5, background: "#111", borderRadius: 2, overflow: "hidden" }}>
          <div style={{
            height: "100%",
            width: `${Math.min(1, Math.max(0, xp.pct)) * 100}%`,
            background: "#59c",
            transition: "width 100ms linear",
          }} />
        </div>
        <div style={{
          fontSize: 11,
          marginTop: 2,
          opacity: 0.7,
          fontVariantNumeric: "tabular-nums",
        }}>
          XP {hero.exp} / {xp.cost || "\u2014"}
        </div>
      </div>
    </ActorCard>
  );
}

// ============================================================
// Shared small components
// ============================================================

function Idle({ msg }: { msg: string }) {
  return (
    <div style={{ opacity: 0.6, fontSize: 14, marginTop: 12 }}>{msg}</div>
  );
}

function PanelHeader({ phaseLabel }: { phaseLabel: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 4 }}>
      <PhaseBadge label={phaseLabel} phase={phaseLabel} />
    </div>
  );
}

function PhaseBadge({ label, phase }: { label: string; phase: string }) {
  const color =
    phase === "fighting" || phase === T.inCombat ? "#58A6FF"
    : phase === "recovering" || phase === T.recovering ? "#F0C674"
    : phase === T.dungeonPhase_waveCleared || phase === T.dungeonPhase_completed ? "#3FB950"
    : phase === T.dungeonPhase_failed || phase === T.dungeonPhase_abandoned ? "#F85149"
    : "#8B949E";
  return (
    <div style={{
      padding: "4px 8px",
      borderRadius: 999,
      border: `1px solid ${color}`,
      color,
      fontSize: 12,
      fontWeight: 600,
      whiteSpace: "nowrap",
    }}>
      {label}
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: 12, opacity: 0.7, marginTop: 14, marginBottom: 6 }}>{children}</div>
  );
}

function GatherPanel({
  activity,
  store,
}: {
  activity: GatherActivity;
  store: GameStore;
}) {
  const node = store.state.actors.find((a) => a.id === activity.nodeId);
  const def = node && isResourceNode(node) ? node : null;
  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ fontSize: 12, opacity: 0.6, marginBottom: 4 }}>
        {T.gatheringLabel}
      </div>
      <div style={{ padding: 8, background: "#222", borderRadius: 4 }}>
        <div style={{ fontWeight: 600 }}>{def?.name ?? activity.nodeId}</div>
        <div style={{ fontSize: 12, opacity: 0.7, marginTop: 4 }}>
          swings: {activity.swingsCompleted} · progress {activity.progressTicks}
          tick(s)
        </div>
      </div>
    </div>
  );
}

function StageRoster({ store }: { store: GameStore }) {
  const stage = store.getFocusedCharacter().stageSession;
  if (!stage) return null;
  const roster = stage.spawnedActorIds
    .map((id) => store.state.actors.find((a) => a.id === id))
    .filter((a): a is NonNullable<typeof a> => a !== undefined);
  if (roster.length === 0) {
    return <Idle msg={T.stageEmpty} />;
  }
  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ fontSize: 12, opacity: 0.6, marginBottom: 4 }}>
        {T.inThisStage}
      </div>
      {roster.map((a) => {
        if (isCharacter(a)) return <ActorCard key={a.id} actor={a} variant="enemy" />;
        return (
          <div
            key={a.id}
            style={{
              marginBottom: 6,
              padding: 8,
              background: "#222",
              borderRadius: 4,
              fontSize: 12,
              opacity: 0.85,
            }}
          >
            <span style={{ fontWeight: 500 }}>{a.name}</span>
            <span style={{ float: "right", opacity: 0.6 }}>
              {a.kind.replace("_", " ")}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ============================================================
// Helpers
// ============================================================

function findCurrentBattle(
  activity: CombatActivity,
  store: GameStore,
): Battle | null {
  if (!activity.currentBattleId) return null;
  return store.state.battles.find((b) => b.id === activity.currentBattleId) ?? null;
}

function getAtbPct(battle: Battle, actorId: string): number {
  return getAtbGaugePct(battle.scheduler, actorId);
}

function combatPhaseLabel(phase: string): string {
  switch (phase) {
    case "recovering": return T.recovering;
    case "searchingEnemies": return T.searchingEnemies;
    case "fighting": return T.inCombat;
    default: return T.stopped;
  }
}

// ── Dungeon phase inference (moved from DungeonStatusPanel) ──

type DungeonPhase =
  | "spawningWave" | "fighting" | "waveCleared"
  | "recovering" | "completed" | "failed" | "abandoned";

function inferDungeonPhase(
  ds: DungeonSession,
  stage: StageSession | null,
  party: PlayerCharacter[],
): DungeonPhase {
  if (ds.status !== "in_progress") return ds.status as DungeonPhase;
  if (stage?.currentWave?.status === "active") return "fighting";
  if (stage?.currentWave?.status === "victory") return "waveCleared";
  if (stage?.currentWave?.status === "defeat") return "failed";
  if (ds.currentWaveIndex > 0 && party.some((h) => h.currentHp <= 0)) return "recovering";
  return "spawningWave";
}

function dungeonPhaseLabel(phase: DungeonPhase): string {
  const map: Record<DungeonPhase, string> = {
    spawningWave: T.dungeonPhase_spawningWave,
    fighting: T.dungeonPhase_fighting,
    waveCleared: T.dungeonPhase_waveCleared,
    recovering: T.dungeonPhase_recovering,
    completed: T.dungeonPhase_completed,
    failed: T.dungeonPhase_failed,
    abandoned: T.dungeonPhase_abandoned,
  };
  return map[phase];
}

// ── Styles ──

const panelStyle: React.CSSProperties = {
  marginTop: 12,
  padding: 12,
  background: "#1d1f22",
  borderRadius: 6,
  border: "1px solid #333",
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

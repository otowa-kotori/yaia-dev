// BattlePanel — the main "what's happening right now" panel.
//
// Layout: left-right split — party (left) vs enemies (right).
// No embedded log — the right sidebar handles that.
// No location selector — that's a separate "map" tab now.

import type { PlayerCharacter } from "../../core/entity/actor";
import { isCharacter, isEnemy, isPlayer, isResourceNode } from "../../core/entity/actor";
import { xpProgressToNextLevel } from "../../core/growth/leveling";
import {
  ACTIVITY_COMBAT_KIND,
  ACTIVITY_GATHER_KIND,
  type CombatActivity,
  type GatherActivity,
} from "../../core/world/activity";
import type { GameStore } from "../store";
import { useStore } from "../hooks/useStore";
import { T, fmt } from "../text";
import { PendingLootPanel } from "../components/PendingLootPanel";
import { ActorCard } from "../components/ActorCard";
import { Card } from "../components/Card";
import { ProgressBar } from "../components/ProgressBar";
import { Badge } from "../components/Badge";
import type { Battle } from "../../core/combat/battle/battle";
import { getAtbGaugePct } from "../../core/combat/battle/scheduler";
import { getContent } from "../../core/content";
import type { DungeonSession } from "../../core/infra/state/types";
import type { GameLogEntry } from "../../core/infra/game-log";
import type { StageSession } from "../../core/world/stage/types";
import { COMBAT_ZONE_ACTIVITY_RULES } from "../../core/world/activity/recovery";


export function BattlePanel({ store }: { store: GameStore }) {
  const { store: s } = useStore(store);
  const cc = s.focused;
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
          <Controls store={s} />
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
        <Controls store={s} />
        {lootPanel}
        <CombatPanel activity={combatAct} store={s} battle={battle} />
      </div>
    );
  }

  // ── Gather ──
  if (activity?.kind === ACTIVITY_GATHER_KIND) {
    return (
      <div>
        <Controls store={s} />
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
// Unified combat panel — LEFT/RIGHT layout: party vs enemies
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
  const phaseProgress = buildCombatPhaseProgress(activity, store);

  const partyHeroes = activity.partyCharIds
    .map((id) => store.state.actors.find((a) => a.id === id))
    .filter((a): a is PlayerCharacter => a !== undefined && isPlayer(a));

  if (!battle) {
    return (
      <Card className="p-3">
        <PanelHeader phaseLabel={phaseLabel} />
        {phaseProgress && (
          <div className="mb-2">
            <ProgressBar
              value={phaseProgress.value}
              max={phaseProgress.max}
              color="atb"
              size="sm"
              label={phaseProgress.label}
              valueLabel={phaseProgress.valueLabel}
            />
          </div>
        )}
        <div className="flex flex-col gap-1">
          {partyHeroes.map((h) => (
            <HeroCard key={h.id} hero={h} statusOverride={phaseLabel} />
          ))}
        </div>
        <StageRoster store={store} />
      </Card>
    );
  }

  const enemies = battle.participantIds
    .map((id) => store.state.actors.find((a) => a.id === id))
    .filter((a) => a !== undefined && isCharacter(a) && isEnemy(a));

  return (
    <Card className="p-3">
      <PanelHeader phaseLabel={phaseLabel} />
      {phaseProgress && (
        <div className="mb-2">
          <ProgressBar
            value={phaseProgress.value}
            max={phaseProgress.max}
            color="atb"
            size="sm"
            label={phaseProgress.label}
            valueLabel={phaseProgress.valueLabel}
          />
        </div>
      )}

      {/* Left-right battle layout */}
      <div className="flex gap-4">
        {/* Left: party */}
        <div className="flex-1 min-w-0">
          <SectionTitle>{T.combatPartyLabel}</SectionTitle>
          <div className="flex flex-col gap-1.5">
            {partyHeroes.map((h) => (
              <HeroCard key={h.id} hero={h} battle={battle} statusOverride={phaseLabel} />
            ))}
          </div>
        </div>

        {/* VS divider */}
        <div className="flex items-center shrink-0">
          <span className="text-gray-600 text-sm font-bold">VS</span>
        </div>

        {/* Right: enemies */}
        <div className="flex-1 min-w-0">
          <SectionTitle>{T.enemies}</SectionTitle>
          <div className="flex flex-col gap-1.5">
            {enemies.map((a) => (
              <ActorCard
                key={a.id}
                actor={a}
                variant="enemy"
                atbPct={getAtbPct(battle, a.id)}
              />
            ))}
          </div>
        </div>
      </div>
    </Card>
  );
}


// ============================================================
// Dungeon panel — left-right layout too
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

  const phase = ds.phase;
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
    <Card className="p-3">
      <div className="flex justify-between items-start gap-3">
        <div>
          <div className="text-[11px] opacity-60 uppercase tracking-wide">
            {T.dungeonPanelTitle}
          </div>
          <div className="mt-1 text-lg font-bold text-white">
            {dungeon?.name ?? ds.dungeonId}
          </div>
        </div>
        <PhaseBadge label={phaseLabel} phase={phase} />
      </div>

      <div className="text-xs opacity-70 mt-2 mb-2">
        {fmt(T.dungeonProgress, { current: currentWave, total: totalWaves })}
      </div>

      {/* Left-right layout */}
      <div className="flex gap-4">
        <div className="flex-1 min-w-0">
          <SectionTitle>{T.combatPartyLabel}</SectionTitle>
          <div className="flex flex-col gap-1.5">
            {partyHeroes.map((h) => (
              <HeroCard key={h.id} hero={h} battle={activeBattle} statusOverride={phaseLabel} />
            ))}
          </div>
        </div>

        {enemies.length > 0 && (
          <>
            <div className="flex items-center shrink-0">
              <span className="text-gray-600 text-sm font-bold">VS</span>
            </div>
            <div className="flex-1 min-w-0">
              <SectionTitle>{T.enemies}</SectionTitle>
              <div className="flex flex-col gap-1.5">
                {enemies.map((a) => (
                  <ActorCard key={a.id} actor={a} variant="enemy"
                    atbPct={activeBattle ? getAtbPct(activeBattle, a.id) : undefined} />
                ))}
              </div>
            </div>
          </>
        )}
      </div>

      <div className="flex justify-end mt-3">
        <button
          type="button"
          onClick={() => {
            if (confirm(T.confirmAbandonDungeon)) {
              store.abandonDungeon(heroId);
            }
          }}
          className="px-3 py-1.5 rounded-md border border-red-900/60 bg-red-950/40 text-red-300 cursor-pointer hover:bg-red-950/60 transition-colors"
        >
          {T.btn_abandonDungeon}
        </button>
      </div>
    </Card>
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
      statusLabel={`Lv ${hero.level} \u00b7 ${statusLabel}`}
      atbPct={inBattle ? getAtbPct(battle, hero.id) : undefined}
    >
      <div className="mt-1">
        <ProgressBar
          value={hero.exp}
          max={xp.cost || 1}
          color="xp"
          size="sm"
          label="XP"
          valueLabel={`${hero.exp} / ${xp.cost || "\u2014"}`}
        />
      </div>
    </ActorCard>
  );
}

// ============================================================
// Shared small components
// ============================================================

function Idle({ msg }: { msg: string }) {
  return (
    <div className="opacity-60 text-sm mt-3">{msg}</div>
  );
}

function PanelHeader({ phaseLabel }: { phaseLabel: string }) {
  return (
    <div className="flex justify-end mb-1">
      <PhaseBadge label={phaseLabel} phase={phaseLabel} />
    </div>
  );
}

function PhaseBadge({ label, phase }: { label: string; phase: string }) {
  const variant = phaseToVariant(phase);
  return <Badge variant={variant}>{label}</Badge>;
}

function phaseToVariant(phase: string): "info" | "warning" | "accent" | "danger" | "neutral" {
  if (phase === "fighting" || phase === T.inCombat) return "info";
  if (
    phase === "deathRecovering" || phase === T.deathRecovering ||
    phase === "waveResting" || phase === T.dungeonPhase_waveResting
  ) return "warning";
  if (phase === T.dungeonPhase_waveCleared || phase === T.dungeonPhase_completed) return "accent";
  if (phase === T.dungeonPhase_failed || phase === T.dungeonPhase_abandoned) return "danger";
  return "neutral";
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-xs opacity-70 mt-3 mb-1.5">{children}</div>
  );
}

function Controls({ store }: { store: GameStore }) {
  const cc = store.focused;

  const running = cc.isRunning();
  if (!running) return null;

  return (
    <div className="flex gap-2 items-center mb-2 flex-wrap">
      <button
        type="button"
        onClick={() => cc.stopActivity()}
        className="px-3 py-1.5 rounded-md text-xs bg-surface-lighter text-gray-300 border border-border hover:border-border-light cursor-pointer transition-colors"
      >
        {T.btn_stop}
      </button>
    </div>
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
    <Card className="mt-2 p-2">
      <div className="font-semibold">{def?.name ?? activity.nodeId}</div>
      <div className="text-xs opacity-70 mt-1">
        swings: {activity.swingsCompleted} · progress {activity.progressTicks} tick(s)
      </div>
    </Card>
  );
}

function StageRoster({ store }: { store: GameStore }) {
  const stage = store.focused.stageSession;

  if (!stage) return null;
  const roster = stage.spawnedActorIds
    .map((id) => store.state.actors.find((a) => a.id === id))
    .filter((a): a is NonNullable<typeof a> => a !== undefined);
  if (roster.length === 0) {
    return <Idle msg={T.stageEmpty} />;
  }
  return (
    <div className="mt-3">
      <div className="text-xs opacity-60 mb-1">
        {T.inThisStage}
      </div>
      {roster.map((a) => {
        if (isCharacter(a)) return <ActorCard key={a.id} actor={a} variant="enemy" />;
        return (
          <Card key={a.id} className="mb-1.5 p-2 text-xs opacity-85">
            <span className="font-medium">{a.name}</span>
            <span className="float-right opacity-60">{a.kind.replace("_", " ")}</span>
          </Card>
        );
      })}
    </div>
  );
}

// ============================================================
// Helpers
// ============================================================

function logsForHero(entries: readonly GameLogEntry[], heroId: string | null | undefined): GameLogEntry[] {
  if (!heroId) return [];
  return entries.filter((e) => e.charId === heroId || e.charId === undefined);
}

function findCurrentBattle(
  activity: CombatActivity,
  store: GameStore,
): Battle | null {
  if (!activity.currentBattleId) return null;
  return store.state.battles.find((b) => b.id === activity.currentBattleId) ?? null;
}

function getAtbPct(battle: Battle, actorId: string): number | undefined {
  if (battle.scheduler.kind !== "atb") return undefined;
  return getAtbGaugePct(battle.scheduler, actorId);
}

function combatPhaseLabel(phase: string): string {
  switch (phase) {
    case "deathRecovering": return T.deathRecovering;
    case "searchingEnemies": return T.searchingEnemies;
    case "fighting": return T.inCombat;
    default: return T.stopped;
  }
}

type DungeonPhase =
  | "spawningWave" | "fighting" | "waveCleared"
  | "waveResting" | "completed" | "failed" | "abandoned";

function dungeonPhaseLabel(phase: DungeonPhase): string {
  const map: Record<DungeonPhase, string> = {
    spawningWave: T.dungeonPhase_spawningWave,
    fighting: T.dungeonPhase_fighting,
    waveCleared: T.dungeonPhase_waveCleared,
    waveResting: T.dungeonPhase_waveResting,
    completed: T.dungeonPhase_completed,
    failed: T.dungeonPhase_failed,
    abandoned: T.dungeonPhase_abandoned,
  };
  return map[phase];
}

function buildCombatPhaseProgress(
  activity: CombatActivity,
  store: GameStore,
): {
  value: number;
  max: number;
  label: string;
  valueLabel: string;
} | null {
  if (activity.phase === "searchingEnemies") {
    const stage = store.state.stages[activity.stageId];
    const pending = stage?.pendingCombatWaveSearch;
    if (!pending) return null;
    const max = Math.max(1, pending.readyAtTick - pending.startedAtTick);
    const value = Math.max(0, Math.min(max, store.state.tick - pending.startedAtTick));
    return {
      value,
      max,
      label: T.searchProgress,
      valueLabel: fmt(T.progressTicks, { done: value, total: max }),
    };
  }
  if (activity.phase === "deathRecovering") {
    const max = COMBAT_ZONE_ACTIVITY_RULES.deathRespawnTicks;
    const value = Math.max(0, Math.min(max, store.state.tick - activity.lastTransitionTick));
    return {
      value,
      max,
      label: T.respawnProgress,
      valueLabel: fmt(T.progressTicks, { done: value, total: max }),
    };
  }
  return null;
}

// Scene view — the main "what's happening right now" panel.
// Shows the hero card always, plus either:
//   - the current battle participants, if a CombatActivity is fighting;
//   - the resource node being gathered, if a GatherActivity is running;
//   - the stage's actor roster, if we're in a stage but idle.
//
// Pure presentation — reads from Store, dispatches nothing.

import type { PlayerCharacter } from "../core/entity/actor";
import { isCharacter, isEnemy, isResourceNode } from "../core/entity/actor";
import { xpProgressToNextLevel } from "../core/growth/leveling";
import {
  ACTIVITY_COMBAT_KIND,
  ACTIVITY_GATHER_KIND,
  type CombatActivity,
  type GatherActivity,
} from "../core/world/activity";
import type { GameStore } from "./store";
import { useStore } from "./useStore";
import { T } from "./text";
import { PendingLootPanel } from "./PendingLootPanel";
import { ActivityLogPanel } from "./ActivityLogPanel";
import {
  DungeonStatusPanel,
  getCharacterDungeonStatusLabel,
} from "./DungeonStatusPanel";
import { ActorCard } from "./ActorCard";
import type { Battle } from "../core/combat/battle/battle";
import { getAtbGaugePct } from "../core/combat/battle/scheduler";

export function BattleView({ store }: { store: GameStore }) {
  const { store: s } = useStore(store);
  const cc = s.getFocusedCharacter();
  const activity = cc.activity;
  const hero = cc.hero;
  const pendingLoot = cc.stageSession?.pendingLoot ?? [];
  const dungeonStatusLabel = getCharacterDungeonStatusLabel(hero, s);
  const battle = findCurrentBattle(activity, s);

  const heroRow = hero ? (
    <HeroCard
      hero={hero}
      activity={activity}
      dungeonStatusLabel={dungeonStatusLabel}
      battle={battle}
    />
  ) : null;
  const lootPanel = pendingLoot.length > 0
    ? <PendingLootPanel cc={cc} pendingLoot={pendingLoot} />
    : null;

  if (!hero.locationId) {
    return (
      <div>
        {heroRow}
        <Idle msg={T.pickLocation} />
      </div>
    );
  }

  if (hero.dungeonSessionId) {
    return (
      <div>
        {heroRow}
        {lootPanel}
        <DungeonStatusPanel
          store={s}
          dungeonSessionId={hero.dungeonSessionId}
          heroId={hero.id}
        />
      </div>
    );
  }

  if (activity?.kind === ACTIVITY_COMBAT_KIND) {
    return (
      <div>
        {heroRow}
        {lootPanel}
        <CombatPanel activity={activity} store={s} battle={battle} />
      </div>
    );
  }

  if (activity?.kind === ACTIVITY_GATHER_KIND) {
    return (
      <div>
        {heroRow}
        {lootPanel}
        <GatherPanel activity={activity} store={s} />
      </div>
    );
  }

  return (
    <div>
      {heroRow}
      {lootPanel}
      <StageRoster store={s} />
    </div>
  );
}

// ---------- Sub-components ----------

function Idle({ msg }: { msg: string }) {
  return (
    <div style={{ opacity: 0.6, fontSize: 14, marginTop: 12 }}>{msg}</div>
  );
}

function CombatPanel({
  activity,
  store,
  battle,
}: {
  activity: CombatActivity;
  store: GameStore;
  battle: Battle | null;
}) {
  const phaseLabel =
    activity.phase === "recovering"
      ? T.recovering
      : activity.phase === "searchingEnemies"
      ? T.searchingEnemies
      : activity.phase === "fighting"
      ? T.inCombat
      : T.stopped;

  if (!battle) {
    return (
      <div>
        <Idle msg={phaseLabel} />
        <StageRoster store={store} />
      </div>
    );
  }

  const enemies = battle.participantIds
    .map((id) => store.state.actors.find((a) => a.id === id))
    .filter((a) => a !== undefined && isCharacter(a) && isEnemy(a));

  return (
    <div>
      <div style={{ marginTop: 8 }}>
        <div style={{ fontSize: 12, opacity: 0.5, marginBottom: 3 }}>
          {T.enemies}
        </div>
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

function HeroCard({
  hero,
  activity,
  dungeonStatusLabel,
  battle,
}: {
  hero: PlayerCharacter;
  activity: CombatActivity | GatherActivity | null;
  dungeonStatusLabel: string | null;
  battle: Battle | null;
}) {
  const xp = xpProgressToNextLevel(hero.level, hero.exp, hero.xpCurve);

  let statusLabel: string = T.status_hero_idle;
  if (dungeonStatusLabel) {
    statusLabel = dungeonStatusLabel;
  } else if (activity?.kind === ACTIVITY_COMBAT_KIND) {
    statusLabel =
      activity.phase === "fighting"
        ? T.status_hero_inCombat
        : activity.phase === "recovering"
        ? T.status_hero_recovering
        : activity.phase === "searchingEnemies"
        ? T.status_hero_searching
        : T.status_hero_idle;
  } else if (activity?.kind === ACTIVITY_GATHER_KIND) {
    statusLabel = T.status_hero_gathering;
  }

  const inBattle = battle && activity?.kind === ACTIVITY_COMBAT_KIND && activity.phase === "fighting";

  return (
    <ActorCard
      actor={hero}
      variant="hero"
      statusLabel={`Lv ${hero.level} · ${statusLabel}`}
      atbPct={inBattle ? getAtbPct(battle, hero.id) : undefined}
    >
      {/* XP bar — only for heroes */}
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

// ---------- Helpers ----------

function findCurrentBattle(
  activity: CombatActivity | GatherActivity | null,
  store: GameStore,
): Battle | null {
  if (!activity || activity.kind !== ACTIVITY_COMBAT_KIND) return null;
  const combatAct = activity as CombatActivity;
  if (!combatAct.currentBattleId) return null;
  return store.state.battles.find((b) => b.id === combatAct.currentBattleId) ?? null;
}

/** Charge-up (前摇) visualization using post-action floor normalization.
 *  See scheduler.ts getAtbGaugePct for the formula. */
function getAtbPct(battle: Battle, actorId: string): number {
  return getAtbGaugePct(battle.scheduler, actorId);
}

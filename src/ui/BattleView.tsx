// Scene view — the main "what's happening right now" panel.
// Shows the hero card always, plus either:
//   - the current battle participants, if a CombatActivity is fighting;
//   - the resource node being gathered, if a GatherActivity is running;
//   - the stage's actor roster, if we're in a stage but idle.
//
// Pure presentation — reads from Store, dispatches nothing.

import type { Character, PlayerCharacter } from "../core/actor";
import { getAttr, isCharacter, isEnemy, isResourceNode } from "../core/actor";
import { ATTR } from "../core/attribute";
import { xpProgressToNextLevel } from "../core/progression";
import {
  ACTIVITY_COMBAT_KIND,
  ACTIVITY_GATHER_KIND,
  type CombatActivity,
  type GatherActivity,
} from "../core/activity";
import { buildDefaultContent } from "../content";
import type { GameStore } from "./store";
import { useStore } from "./useStore";
import { T } from "./text";

const ATTR_DEFS = buildDefaultContent().attributes;

export function BattleView({ store }: { store: GameStore }) {
  const { store: s } = useStore(store);
  const cc = s.getFocusedCharacter();
  const activity = cc.activity;
  const hero = cc.hero;

  const heroRow = hero ? <HeroCard hero={hero} activity={activity} /> : null;

  if (!hero.locationId) {
    return (
      <div>
        {heroRow}
        <Idle msg={T.pickLocation} />
      </div>
    );
  }

  // Combat view
  if (activity?.kind === ACTIVITY_COMBAT_KIND) {
    return (
      <div>
        {heroRow}
        <CombatPanel activity={activity} store={s} />
      </div>
    );
  }

  // Gather view
  if (activity?.kind === ACTIVITY_GATHER_KIND) {
    return (
      <div>
        {heroRow}
        <GatherPanel activity={activity} store={s} />
      </div>
    );
  }

  // In a stage but not doing anything — show the roster.
  return (
    <div>
      {heroRow}
      <StageRoster store={s} />
    </div>
  );
}

function Idle({ msg }: { msg: string }) {
  return (
    <div style={{ opacity: 0.6, fontSize: 14, marginTop: 12 }}>{msg}</div>
  );
}

function CombatPanel({
  activity,
  store,
}: {
  activity: CombatActivity;
  store: GameStore;
}) {
  const battle =
    activity.currentBattleId
      ? store.state.battles.find((b) => b.id === activity.currentBattleId) ??
        null
      : null;
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

  const participants = battle.participantIds
    .map((id) => store.state.actors.find((a) => a.id === id))
    .filter((a): a is Character => a !== undefined && isCharacter(a));
  const enemies = participants.filter(isEnemy);

  return (
    <div>
      <div style={{ marginTop: 12 }}>
        <div style={{ fontSize: 12, opacity: 0.6, marginBottom: 4 }}>
          {T.enemies}
        </div>
        {enemies.map((a) => (
          <ActorRow key={a.id} actor={a} />
        ))}
      </div>
      <LogTail log={battle.log} />
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
        if (isCharacter(a)) return <ActorRow key={a.id} actor={a} />;
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
}: {
  hero: PlayerCharacter;
  activity: CombatActivity | GatherActivity | null;
}) {
  const maxHp = Math.max(1, getAttr(hero, ATTR.MAX_HP, ATTR_DEFS));
  const hpPct = Math.max(0, Math.min(1, hero.currentHp / maxHp));
  const dead = hero.currentHp <= 0;
  const xp = xpProgressToNextLevel(hero.level, hero.exp, hero.xpCurve);

  let statusLabel: string = T.status_hero_idle;
  if (activity?.kind === ACTIVITY_COMBAT_KIND) {
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
          {dead ? ` (${T.ko})` : ""}
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
  const maxHp = Math.max(1, getAttr(actor, ATTR.MAX_HP, ATTR_DEFS));
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
          {dead ? ` (${T.ko})` : ""}
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

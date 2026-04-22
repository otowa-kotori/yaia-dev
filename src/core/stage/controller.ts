// StageController — spawn/search engine for the current running instance.
//
// With the Location / Entry / Instance split, this controller no longer
// knows about "stages" in the old sense. It manages the actor population
// of a single chosen entry (combat zone or gather site).
//
// Ticking responsibilities:
//   1. At enter: spawn gather nodes immediately. Combat entries start empty;
//      CombatActivity explicitly requests a wave search when it wants the
//      next combat zone wave to begin.
//   2. Each tick: reap dead instance-owned enemies that are no longer
//      referenced by any ongoing battle.
//   3. When a requested wave search reaches its ready tick, spawn the next
//      randomly selected wave from the combat zone.
//   4. On leave: remove every actor whose id is in spawnedActorIds.
//
// The controller does NOT run combat. CombatActivity reads the living
// enemies out of state.actors filtered by isEnemy ∩ spawnedActorIds.
//
// The controller also does NOT manage gather progress; GatherActivity does.
// The controller just spawns the nodes and leaves them in the world.

import {
  createEnemy,
  createResourceNode,
  isEnemy,
  type Actor,
  type Enemy,
} from "../actor";
import type { AttrDef, CombatZoneDef, WaveDef } from "../content/types";
import { getCombatZone, getMonster, getResourceNode } from "../content/registry";
import type { GameEventBus } from "../events";
import type { Rng } from "../rng";
import {
  mintMonsterInstanceId,
  mintResourceNodeInstanceId,
} from "../runtime-ids";
import type { GameState } from "../state/types";
import type { Tickable } from "../tick";
import type { StageMode, StageSession } from "./types";

export interface StageControllerContext {
  state: GameState;
  bus: GameEventBus;
  rng: Rng;
  attrDefs: Readonly<Record<string, AttrDef>>;
  currentTick: number;
}

export interface StageController extends Tickable {
  readonly locationId: string;
  readonly mode: StageMode;
}

export interface CreateStageControllerOptions {
  /** Unique id for this stage instance, used as key in state.stages. */
  stageId: string;
  locationId: string;
  /** What kind of activity this stage runs. Default: gather. */
  mode?: StageMode;
  /** Resource nodes to spawn (for gather entries). */
  resourceNodes?: string[];
  ctxProvider: () => StageControllerContext;
  /** If provided, the session pre-exists (e.g. load-from-save). Otherwise a
   *  fresh session is created and the initial population spawned. */
  resume?: boolean;
}

export const DEFAULT_WAVE_SEARCH_TICKS = 20;

/** Enter an instance: create session, spawn initial population, return a
 *  Tickable controller you should register on the tick engine. */
export function enterStage(opts: CreateStageControllerOptions): StageController {
  const mode: StageMode = opts.mode ?? { kind: "gather" };
  const stageId = opts.stageId;
  const initialCtx = opts.ctxProvider();

  if (!opts.resume) {
    if (initialCtx.state.stages[stageId]) {
      throw new Error(
        `stage: cannot enter instance "${stageId}" — already exists; leaveStage first`,
      );
    }
    const session = freshSession(
      opts.locationId,
      mode,
      initialCtx.currentTick,
    );
    initialCtx.state.stages[stageId] = session;

    // Spawn resource nodes if this is a gather entry.
    if (opts.resourceNodes && opts.resourceNodes.length > 0) {
      spawnResourceNodes(opts.resourceNodes, session, initialCtx);
    }
  }

  // Capture combat zone def once for the tick closure (null for non-combatZone).
  const zoneDef =
    mode.kind === "combatZone" ? getCombatZone(mode.combatZoneId) : null;

  const controller: StageController = {
    id: `stage:${stageId}`,
    locationId: opts.locationId,
    mode,
    tick() {
      const ctx = opts.ctxProvider();
      const session = ctx.state.stages[stageId];
      if (!session) return;
      stepController(zoneDef, session, ctx);
    },
  };
  return controller;
}

/** Tear down a stage instance: remove all spawned actors, delete the
 *  session from state.stages. Safe to call when the stageId doesn't exist
 *  (no-op). Removing the controller from the tick engine is the caller's
 *  job (they have the handle). */
export function leaveStage(stageId: string, ctx: StageControllerContext): void {
  const session = ctx.state.stages[stageId];
  if (!session) return;
  const toRemove = new Set(session.spawnedActorIds);
  ctx.state.actors = ctx.state.actors.filter((a) => !toRemove.has(a.id));
  // Any battle that referenced those actors is now dead weight — drop them.
  ctx.state.battles = ctx.state.battles.filter((b) => {
    return !b.participantIds.some((id) => toRemove.has(id));
  });
  delete ctx.state.stages[stageId];
}

export function beginCombatWaveSearch(
  zone: CombatZoneDef,
  session: StageSession,
  currentTick: number,
): void {
  if (session.currentWave) return;
  if (session.pendingCombatWaveSearch) return;
  const waveSearchTicks = Math.max(
    0,
    zone.waveSearchTicks ?? DEFAULT_WAVE_SEARCH_TICKS,
  );
  session.pendingCombatWaveSearch = {
    startedAtTick: currentTick,
    readyAtTick: currentTick + waveSearchTicks,
  };
}

// ---------- Step ----------

function stepController(
  zone: CombatZoneDef | null,
  session: StageSession,
  ctx: StageControllerContext,
): void {
  // Reap dead instance-owned enemies first.
  reapDeadEnemies(session, ctx);

  if (!zone) return; // gather-only — nothing to step

  if (session.currentWave?.status === "active") {
    return;
  }

  if (session.currentWave) {
    clearResolvedWaveActors(session, ctx);
    session.currentWave = null;
  }

  progressWaveSearch(zone, session, ctx);
}

// ---------- Reaping ----------

/** Remove instance-owned dead enemies that no ongoing battle still references.
 *  Without this they accumulate forever and bloat the save file. */
function reapDeadEnemies(
  session: StageSession,
  ctx: StageControllerContext,
): void {
  const owned = new Set(session.spawnedActorIds);
  const heldByBattle = new Set<string>();
  for (const b of ctx.state.battles) {
    if (b.outcome !== "ongoing") continue;
    for (const id of b.participantIds) heldByBattle.add(id);
  }

  const toCollect: string[] = [];
  for (const a of ctx.state.actors) {
    if (!owned.has(a.id)) continue;
    if (!isEnemy(a)) continue;
    if (a.currentHp > 0) continue;
    if (heldByBattle.has(a.id)) continue;
    toCollect.push(a.id);
  }
  if (toCollect.length === 0) return;

  const collect = new Set(toCollect);
  ctx.state.actors = ctx.state.actors.filter((a) => !collect.has(a.id));
  session.spawnedActorIds = session.spawnedActorIds.filter(
    (id) => !collect.has(id),
  );
}

// ---------- Spawning ----------

function spawnResourceNodes(
  nodeIds: string[],
  session: StageSession,
  ctx: StageControllerContext,
): void {
  for (let i = 0; i < nodeIds.length; i++) {
    const defId = nodeIds[i]!;
    const nodeDef = getResourceNode(defId);
    const instanceId = mintResourceNodeInstanceId(ctx.state, nodeDef.id);
    const actor = createResourceNode({ instanceId, def: nodeDef });
    ctx.state.actors.push(actor);
    session.spawnedActorIds.push(instanceId);
  }
}

function spawnCombatWave(zone: CombatZoneDef, session: StageSession, ctx: StageControllerContext): void {
  const wave = pickCombatZoneWave(zone, ctx.rng);

  session.combatWaveIndex += 1;
  const enemyIds: string[] = [];
  for (let i = 0; i < wave.monsters.length; i++) {
    const monsterId = wave.monsters[i]!;
    const mdef = getMonster(monsterId);
    const instanceId = mintMonsterInstanceId(ctx.state, mdef.id);
    const enemy = createEnemy({
      instanceId,
      def: mdef,
      attrDefs: ctx.attrDefs,
    });
    ctx.state.actors.push(enemy);
    session.spawnedActorIds.push(instanceId);
    enemyIds.push(instanceId);
  }

  session.currentWave = {
    combatZoneId: zone.id,
    waveId: wave.id,
    waveIndex: session.combatWaveIndex,
    enemyIds,
    status: "active",
    rewardGranted: false,
  };
  session.pendingCombatWaveSearch = null;
}

// ---------- Queries (consumed by Activities) ----------

/** All enemies belonging to the current instance, alive or dead. */
export function stageEnemies(
  session: StageSession,
  state: GameState,
): Enemy[] {
  const own = new Set(session.spawnedActorIds);
  return state.actors.filter((a): a is Enemy => isEnemy(a) && own.has(a.id));
}

/** All resource nodes belonging to the current instance. */
export function stageResourceNodes(
  session: StageSession,
  state: GameState,
): Actor[] {
  const own = new Set(session.spawnedActorIds);
  return state.actors.filter(
    (a) => a.kind === "resource_node" && own.has(a.id),
  );
}

export function lookupWave(
  zone: CombatZoneDef,
  waveId: string,
): WaveDef {
  const wave = zone.waves.find((x) => x.id === waveId);
  if (!wave) {
    throw new Error(
      `stage: combatZone "${zone.id}" has no wave "${waveId}"`,
    );
  }
  return wave;
}

// ---------- Internal ----------

function pickCombatZoneWave(zone: CombatZoneDef, rng: Rng): WaveDef {
  if (zone.waves.length === 0) {
    throw new Error(`stage: combatZone "${zone.id}" has no waves`);
  }
  switch (zone.waveSelection ?? "random") {
    case "random":
      return rng.pick(zone.waves);
  }
}

function clearResolvedWaveActors(
  session: StageSession,
  ctx: StageControllerContext,
): void {
  const wave = session.currentWave;
  if (!wave || wave.status === "active") return;
  if (wave.enemyIds.length === 0) return;

  const enemyIds = new Set(wave.enemyIds);
  ctx.state.actors = ctx.state.actors.filter((a) => !enemyIds.has(a.id));
  session.spawnedActorIds = session.spawnedActorIds.filter(
    (id) => !enemyIds.has(id),
  );
  wave.enemyIds = [];
}

function progressWaveSearch(
  zone: CombatZoneDef,
  session: StageSession,
  ctx: StageControllerContext,
): void {
  const pending = session.pendingCombatWaveSearch;
  if (!pending) return;
  if (ctx.currentTick < pending.readyAtTick) return;
  session.pendingCombatWaveSearch = null;
  spawnCombatWave(zone, session, ctx);
}

function freshSession(
  locationId: string,
  mode: StageMode,
  currentTick: number,
): StageSession {
  return {
    locationId,
    mode,
    enteredAtTick: currentTick,
    spawnedActorIds: [],
    combatWaveIndex: 0,
    pendingCombatWaveSearch: null,
    currentWave: null,
    pendingLoot: [],
  };
}

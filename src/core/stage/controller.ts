// StageController — spawn/respawn engine for the current stage.
//
// Ticking responsibilities:
//   1. At enter: spawn the stage's initial ResourceNodes + open the first
//      combat wave of the active encounter (if the stage has combat configured).
//   2. Each tick: reap dead stage-owned enemies that are no longer
//      referenced by any ongoing battle (keeps state.actors + save size
//      bounded — without this, every slime you kill stays resident forever).
//   3. When the current wave resolves, wait for combatWaveCooldownTicks and
//      then spawn the next randomly selected wave from the active encounter.
//   4. On leave: remove every actor whose id is in spawnedActorIds.
//
// The controller does NOT run combat. Whoever wants to fight (a
// CombatActivity) reads the living enemies out of state.actors filtered
// by `isEnemy` ∩ `spawnedActorIds`.
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
import type { AttrDef, EncounterDef, StageDef, WaveDef } from "../content/types";
import { getMonster, getResourceNode, getStage } from "../content/registry";
import type { GameEventBus } from "../events";
import type { Rng } from "../rng";
import type { GameState } from "../state/types";
import type { Tickable } from "../tick";
import type { ActiveCombatWaveSession, StageSession } from "./types";

export interface StageControllerContext {
  state: GameState;
  bus: GameEventBus;
  rng: Rng;
  attrDefs: Readonly<Record<string, AttrDef>>;
  currentTick: number;
}

export interface StageController extends Tickable {
  readonly stageId: string;
}

export interface CreateStageControllerOptions {
  stageId: string;
  ctxProvider: () => StageControllerContext;
  /** If provided, the session pre-exists (e.g. load-from-save). Otherwise a
   *  fresh session is created and the initial population spawned. */
  resume?: boolean;
}

/** Enter a stage: create session, spawn initial population, return a
 *  Tickable controller you should register on the tick engine. */
export function enterStage(opts: CreateStageControllerOptions): StageController {
  const stageDef = getStage(opts.stageId); // throw on typo
  const initialCtx = opts.ctxProvider();

  if (!opts.resume) {
    if (initialCtx.state.currentStage) {
      throw new Error(
        `stage: cannot enter "${opts.stageId}" — already in "${initialCtx.state.currentStage.stageId}"; leaveStage first`,
      );
    }
    initialCtx.state.currentStage = freshSession(stageDef, initialCtx.currentTick);
    // Spawn the initial population.
    spawnResourceNodes(stageDef, initialCtx);
    const encounter = currentEncounter(stageDef, initialCtx.state.currentStage);
    if (encounter) {
      spawnCombatWave(encounter, initialCtx);
    }
  }

  const controller: StageController = {
    id: `stage:${opts.stageId}`,
    stageId: opts.stageId,
    tick() {
      const ctx = opts.ctxProvider();
      stepController(stageDef, ctx);
    },
  };
  return controller;
}

/** Tear down the current stage: remove all spawned actors, clear the
 *  session. Safe to call when no stage is active (no-op). Removes the
 *  controller from the tick engine is the caller's job (they have the
 *  handle). */
export function leaveStage(ctx: StageControllerContext): void {
  const session = ctx.state.currentStage;
  if (!session) return;
  const toRemove = new Set(session.spawnedActorIds);
  ctx.state.actors = ctx.state.actors.filter((a) => !toRemove.has(a.id));
  // Any battle that referenced those actors is now dead weight — drop them.
  ctx.state.battles = ctx.state.battles.filter((b) => {
    return !b.participantIds.some((id) => toRemove.has(id));
  });
  ctx.state.currentStage = null;
}

// ---------- Step ----------

function stepController(def: StageDef, ctx: StageControllerContext): void {
  const session = ctx.state.currentStage;
  if (!session) return;

  // Reap dead stage-owned enemies first. Anything still referenced by an
  // ongoing battle stays (so the battle's tick loop can read its corpse
  // and emit the death/kill events cleanly). CombatActivity removes
  // finished battles from state.battles, so by the next controller tick
  // the reference is gone and the enemy is collectible.
  reapDeadEnemies(session, ctx);

  const encounter = currentEncounter(def, session);
  if (!encounter) return;

  if (!session.currentWave) {
    if (session.combatWaveCooldownTicks > 0) {
      tickWaveCooldown(encounter, session, ctx);
      return;
    }
    spawnCombatWave(encounter, ctx);
    return;
  }

  if (session.currentWave.status === "active") {
    return;
  }

  clearResolvedWaveActors(session, ctx);
  tickWaveCooldown(encounter, session, ctx);
}

const DEFAULT_WAVE_INTERVAL = 20;

// ---------- Reaping ----------

/** Remove stage-owned dead enemies that no ongoing battle still references.
 *  Without this they accumulate forever and bloat the save file. */
function reapDeadEnemies(
  session: StageSession,
  ctx: StageControllerContext,
): void {
  const owned = new Set(session.spawnedActorIds);
  // Anything referenced by an ongoing battle is off-limits this tick.
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

function spawnResourceNodes(def: StageDef, ctx: StageControllerContext): void {
  const session = ctx.state.currentStage!;
  const nodeIds = def.resourceNodes ?? [];
  for (let i = 0; i < nodeIds.length; i++) {
    const defId = nodeIds[i]!;
    const nodeDef = getResourceNode(defId);
    const instanceId = `node.${defId}.${session.stageId}.${i}`;
    const actor = createResourceNode({ instanceId, def: nodeDef });
    ctx.state.actors.push(actor);
    session.spawnedActorIds.push(instanceId);
  }
}

function spawnCombatWave(encounter: EncounterDef, ctx: StageControllerContext): void {
  const session = ctx.state.currentStage!;
  const wave = pickEncounterWave(encounter, ctx.rng);

  session.combatWaveIndex += 1;
  const enemyIds: string[] = [];
  for (let i = 0; i < wave.monsters.length; i++) {
    const monsterId = wave.monsters[i]!;
    const mdef = getMonster(monsterId);
    const instanceId =
      `enemy.${monsterId}.${session.stageId}.${encounter.id}.w${session.combatWaveIndex}.${i}`;
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
    encounterId: encounter.id,
    waveId: wave.id,
    waveIndex: session.combatWaveIndex,
    enemyIds,
    status: "active",
    rewardGranted: false,
  };
  session.combatWaveCooldownTicks = 0;
}

// ---------- Queries (consumed by Activities) ----------

/** All enemies belonging to the current stage, alive or dead. */
export function stageEnemies(
  session: StageSession,
  state: GameState,
): Enemy[] {
  const own = new Set(session.spawnedActorIds);
  return state.actors.filter((a): a is Enemy => isEnemy(a) && own.has(a.id));
}

/** All resource nodes belonging to the current stage. */
export function stageResourceNodes(
  session: StageSession,
  state: GameState,
): Actor[] {
  const own = new Set(session.spawnedActorIds);
  return state.actors.filter(
    (a) => a.kind === "resource_node" && own.has(a.id),
  );
}

export function lookupEncounter(
  def: StageDef,
  encounterId: string,
): EncounterDef {
  const encounter = (def.encounters ?? []).find((x) => x.id === encounterId);
  if (!encounter) {
    throw new Error(
      `stage: stage "${def.id}" has no encounter "${encounterId}"`,
    );
  }
  return encounter;
}

export function lookupWave(
  encounter: EncounterDef,
  waveId: string,
): WaveDef {
  const wave = encounter.waves.find((x) => x.id === waveId);
  if (!wave) {
    throw new Error(
      `stage: encounter "${encounter.id}" has no wave "${waveId}"`,
    );
  }
  return wave;
}

// ---------- Internal ----------

function currentEncounter(
  def: StageDef,
  session: StageSession,
): EncounterDef | null {
  const encounters = def.encounters ?? [];
  if (encounters.length === 0) return null;
  if (!session.activeEncounterId) {
    session.activeEncounterId = encounters[0]!.id;
  }
  return lookupEncounter(def, session.activeEncounterId);
}

function pickEncounterWave(encounter: EncounterDef, rng: Rng): WaveDef {
  if (encounter.waves.length === 0) {
    throw new Error(`stage: encounter "${encounter.id}" has no waves`);
  }
  switch (encounter.waveSelection ?? "random") {
    case "random":
      return rng.pick(encounter.waves);
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

function tickWaveCooldown(
  encounter: EncounterDef,
  session: StageSession,
  ctx: StageControllerContext,
): void {
  if (session.combatWaveCooldownTicks <= 0) {
    session.combatWaveCooldownTicks =
      encounter.waveIntervalTicks ?? DEFAULT_WAVE_INTERVAL;
    return;
  }

  session.combatWaveCooldownTicks -= 1;
  if (session.combatWaveCooldownTicks === 0) {
    spawnCombatWave(encounter, ctx);
  }
}

function freshSession(def: StageDef, currentTick: number): StageSession {
  return {
    stageId: def.id,
    enteredAtTick: currentTick,
    spawnedActorIds: [],
    activeEncounterId: def.encounters?.[0]?.id ?? null,
    combatWaveCooldownTicks: 0,
    combatWaveIndex: 0,
    currentWave: null,
  };
}

// StageController — spawn/respawn engine for the current stage.
//
// Ticking responsibilities:
//   1. At enter: spawn the stage's initial ResourceNodes + open the first
//      combat wave (if the stage has combat configured).
//   2. Each tick: reap dead stage-owned enemies that are no longer
//      referenced by any ongoing battle (keeps state.actors + save size
//      bounded — without this, every slime you kill stays resident forever).
//   3. In the fighting phase: nothing, until all enemies are dead → set
//      combatWaveCooldownTicks; then tick it down; at 0, spawn a new wave.
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
import type { AttrDef, StageDef } from "../content/types";
import { getMonster, getResourceNode, getStage } from "../content/registry";
import type { GameEventBus } from "../events";
import type { Rng } from "../rng";
import type { GameState } from "../state/types";
import type { Tickable } from "../tick";
import type { StageSession } from "./types";

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
    initialCtx.state.currentStage = freshSession(
      opts.stageId,
      initialCtx.currentTick,
    );
    // Spawn the initial population.
    spawnResourceNodes(stageDef, initialCtx);
    spawnCombatWave(stageDef, initialCtx);
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

  // Combat wave respawn: when no stage-spawned enemies are alive, start the
  // cooldown countdown; when it hits 0, spawn a new wave.
  if ((def.monsters?.length ?? 0) > 0) {
    const aliveEnemies = stageEnemies(session, ctx.state).filter(
      (e) => e.currentHp > 0,
    );
    if (aliveEnemies.length === 0) {
      if (session.combatWaveCooldownTicks <= 0) {
        session.combatWaveCooldownTicks =
          def.waveIntervalTicks ?? DEFAULT_WAVE_INTERVAL;
      } else {
        session.combatWaveCooldownTicks -= 1;
        if (session.combatWaveCooldownTicks === 0) {
          spawnCombatWave(def, ctx);
        }
      }
    }
  }
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

function spawnCombatWave(def: StageDef, ctx: StageControllerContext): void {
  const session = ctx.state.currentStage!;
  const monsters = def.monsters ?? [];
  if (monsters.length === 0) return;

  session.combatWaveIndex += 1;
  const waveSize = Math.max(1, def.waveSize ?? 1);
  for (let i = 0; i < waveSize; i++) {
    const monsterId = ctx.rng.pick(monsters);
    const mdef = getMonster(monsterId);
    const instanceId = `enemy.${monsterId}.${session.stageId}.w${session.combatWaveIndex}.${i}`;
    const enemy = createEnemy({
      instanceId,
      def: mdef,
      attrDefs: ctx.attrDefs,
    });
    ctx.state.actors.push(enemy);
    session.spawnedActorIds.push(instanceId);
  }
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

// ---------- Internal ----------

function freshSession(stageId: string, currentTick: number): StageSession {
  return {
    stageId,
    enteredAtTick: currentTick,
    spawnedActorIds: [],
    combatWaveCooldownTicks: 0,
    combatWaveIndex: 0,
  };
}

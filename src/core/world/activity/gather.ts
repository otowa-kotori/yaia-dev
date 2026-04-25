// GatherActivity — continuous resource-gathering loop.
//
// State machine:
//
//   swinging — swingTicks elapse → one swing completes → yield + XP
//              → repeat.
//   stopped — terminal; tick engine auto-unregisters via isDone().
//
// swingTicks is currently fixed (from ResourceNodeDef). Future: formula
// over skill level + attributes + tool bonuses.
//
// Rewards flow via applyEffect on a synthesized instant Effect — same
// codepath as kill rewards — so loot tables / skill XP / future proc
// effects share one pipeline.
//
// Save/load: a GatherActivity is represented in the save as
// PlayerCharacter.activity with kind=ACTIVITY_GATHER_KIND and
// data={ nodeId, progressTicks }. On load, store code reconstructs the
// live activity via createGatherActivity with opts.resume set.

import { isPlayer, isResourceNode, type PlayerCharacter } from "../../entity/actor";
import { getResourceNode, getSkill } from "../../content/registry";
import type { ResourceNodeDef } from "../../content/types";
import type { GameState } from "../../infra/state/types";
import { applyEffect, type EffectContext } from "../../behavior/effect";
import type { CharacterActivity, ActivityContext } from "./types";

export const ACTIVITY_GATHER_KIND = "activity.gather";

export interface GatherActivityOptions {
  ownerCharacterId: string;
  /** ResourceNode actor id (from GameState.actors). */
  nodeId: string;
  ctxProvider: () => ActivityContext;
  /** Pre-set progress on resume. Default: 0. */
  resume?: {
    progressTicks: number;
  };
}

export interface GatherActivity extends CharacterActivity {
  readonly kind: typeof ACTIVITY_GATHER_KIND;
  /** Runtime actor id of the node being gathered. */
  readonly nodeId: string;
  /** Progress toward the next swing, in ticks. Resets on completion. */
  progressTicks: number;
  /** Total swings completed in this session. For UI/debug. */
  swingsCompleted: number;
  /** Terminal flag. */
  stopRequested: boolean;
}

// ---------- Factory ----------

export function createGatherActivity(
  opts: GatherActivityOptions,
): GatherActivity {
  const initialCtx = opts.ctxProvider();

  // Resolve the node's def at construction to fail loudly if the node
  // vanished between saves.
  resolveNodeDef(opts.nodeId, initialCtx.state);

  const id = `gather:${opts.ownerCharacterId}:${opts.nodeId}`;

  const activity: GatherActivity = {
    id,
    kind: ACTIVITY_GATHER_KIND,
    startedAtTick: initialCtx.currentTick,
    ownerCharacterId: opts.ownerCharacterId,
    nodeId: opts.nodeId,
    progressTicks: opts.resume?.progressTicks ?? 0,
    swingsCompleted: 0,
    stopRequested: false,

    tick() {
      const ctx = opts.ctxProvider();
      stepActivity(activity, ctx);
    },

    isDone() {
      return activity.stopRequested;
    },
  };

  return activity;
}

// ---------- Step ----------

function stepActivity(
  activity: GatherActivity,
  ctx: ActivityContext,
): void {
  if (activity.stopRequested) return;

  const def = resolveNodeDef(activity.nodeId, ctx.state);
  const hero = findHero(activity, ctx.state);
  if (!hero) {
    activity.stopRequested = true;
    return;
  }

  activity.progressTicks += 1;
  if (activity.progressTicks < def.swingTicks) return;

  // One swing completed.
  activity.progressTicks = 0;
  activity.swingsCompleted += 1;
  grantSwingRewards(def, hero, ctx);
  syncActivityPointer(activity, hero);
}

/** Reward flow: synthesize an instant Effect carrying the node's drops +
 *  skill XP, then run it through the normal Effect pipeline. */
function grantSwingRewards(
  def: ResourceNodeDef,
  hero: PlayerCharacter,
  ctx: ActivityContext,
): void {
  // Roll the loot table. Each entry has a chance; on hit, qty is a uniform
  // integer in [minQty, maxQty].
  const itemDrops: { itemId: (typeof def.drops)[number]["itemId"]; qty: number }[] = [];
  for (const d of def.drops) {
    if (!ctx.rng.chance(d.chance)) continue;
    const qty = ctx.rng.int(d.minQty, d.maxQty);
    if (qty > 0) itemDrops.push({ itemId: d.itemId, qty });
  }

  // Validate the skill exists so rewards.xp doesn't silently no-op.
  getSkill(def.skill);

  const rewardEffect = {
    id: `effect.runtime.gather.${def.id}` as never,
    kind: "instant" as const,
    rewards: {
      items: itemDrops.length > 0 ? itemDrops : undefined,
      xp: [{ skillId: def.skill, amount: def.xpPerSwing }],
    },
  };

  const ectx: EffectContext = {
    state: ctx.state,
    bus: ctx.bus,
    rng: ctx.rng,
    attrDefs: ctx.attrDefs,
    currentTick: ctx.currentTick,
    currencyChangeSource: "other",
  };

  // Target is the hero herself — gather rewards land in the hero's
  // inventory + skill progression.
  applyEffect(rewardEffect, hero, hero, ectx);
}

// ---------- Helpers ----------

function resolveNodeDef(nodeId: string, state: GameState): ResourceNodeDef {
  const node = state.actors.find((a) => a.id === nodeId);
  if (!node || !isResourceNode(node)) {
    throw new Error(`gather: actor "${nodeId}" is not a resource node`);
  }
  return getResourceNode(node.defId);
}

function findHero(
  activity: GatherActivity,
  state: GameState,
): PlayerCharacter | null {
  const a = state.actors.find((x) => x.id === activity.ownerCharacterId);
  if (!a || !isPlayer(a)) return null;
  return a;
}

/** Mirror current activity state onto hero.activity so autosave captures
 *  per-swing progress. */
function syncActivityPointer(
  activity: GatherActivity,
  hero: PlayerCharacter,
): void {
  hero.activity = {
    kind: ACTIVITY_GATHER_KIND,
    startedAtTick: activity.startedAtTick,
    data: {
      nodeId: activity.nodeId,
      progressTicks: activity.progressTicks,
      swingsCompleted: activity.swingsCompleted,
    },
  };
}

// CombatActivity: ties a Battle into the tick engine.
//
// - Character-owned (for party mode, we'd install one per participating
//   player OR a shared one — MVP installs ONE CombatActivity whose owner is
//   the "lead" player character. The rest are pure battle participants.)
// - On each tick(), delegates to tickBattle.
// - When battle.outcome != "ongoing", applies end-of-battle bookkeeping:
//     * remove the activity from the owner character
//     * optionally despawn defeated enemies from GameState.actors
//     * does NOT grant XP/loot yet — that needs the skill system (Step 4)
//   The activity still emits a `activityComplete` event so later subsystems
//   can hook in.

import { isEnemy } from "../actor";
import type { GameState } from "../state/types";
import {
  tickBattle,
  type Battle,
  type TickBattleContext,
} from "../combat";
import type {
  ActivityContext,
  CharacterActivity,
} from "./types";

export const ACTIVITY_COMBAT_KIND = "activity.combat";

export interface CombatActivityOptions {
  ownerCharacterId: string;
  battle: Battle;
  ctxProvider: () => ActivityContext;
  /** If true, remove defeated enemy actors from GameState.actors on end.
   *  Defaults to true — keeps the world tidy. Bosses or narrative actors
   *  can override with false. */
  removeDefeatedEnemies?: boolean;
}

export interface CombatActivity extends CharacterActivity {
  readonly kind: typeof ACTIVITY_COMBAT_KIND;
  readonly battle: Battle;
}

export function createCombatActivity(opts: CombatActivityOptions): CombatActivity {
  const { battle, ownerCharacterId } = opts;
  const removeDefeated = opts.removeDefeatedEnemies ?? true;
  let finished = false;

  const id = `combat:${battle.id}`;

  const activity: CombatActivity = {
    id,
    kind: ACTIVITY_COMBAT_KIND,
    startedAtTick: battle.startedAtTick,
    ownerCharacterId,
    battle,

    tick() {
      if (finished) return;
      const ctx = opts.ctxProvider();
      const bctx: TickBattleContext = {
        state: ctx.state,
        bus: ctx.bus,
        rng: ctx.rng,
        attrDefs: ctx.attrDefs,
        currentTick: ctx.currentTick,
      };
      tickBattle(battle, bctx);

      if (battle.outcome !== "ongoing" && !finished) {
        finished = true;
        finishBattle(battle, ctx, ownerCharacterId, removeDefeated);
      }
    },

    isDone() {
      return finished;
    },
  };

  return activity;
}

function finishBattle(
  battle: Battle,
  ctx: ActivityContext,
  ownerCharacterId: string,
  removeDefeated: boolean,
): void {
  // Clear the owner's activity slot (if the GameState knows about it).
  const owner = ctx.state.actors.find((a) => a.id === ownerCharacterId);
  if (owner && "activity" in owner) {
    // PlayerCharacter has .activity — clear it.
    (owner as unknown as { activity: null }).activity = null;
  }

  if (removeDefeated) {
    ctx.state.actors = ctx.state.actors.filter((a) => {
      if (!battle.participantIds.includes(a.id)) return true;
      if (!isEnemy(a)) return true;
      // Enemy participant: keep if alive, remove if dead.
      return a.currentHp > 0;
    });
  }

  ctx.bus.emit("activityComplete", {
    charId: ownerCharacterId,
    kind: ACTIVITY_COMBAT_KIND,
  });
}

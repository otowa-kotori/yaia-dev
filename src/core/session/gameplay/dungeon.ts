import { getDungeon } from "../../content";
import type { PlayerCharacter } from "../../entity/actor";
import type { DungeonSession, GameState } from "../../infra/state";
import {
  ACTIVITY_DUNGEON_KIND,
  abandonDungeon as abandonDungeonCore,
  createDungeonActivity,
} from "../../world/activity";
import {
  enterStage as enterStageCore,
  leaveStage as leaveStageCore,
} from "../../world/stage";
import { mintDungeonSessionId, mintStageId } from "../../runtime-ids";
import { tearDownCharInstance } from "../runtime";
import type { SessionRuntime } from "../types";

export interface DungeonGameplay {
  restoreDungeonParty(dungeonSessionId: string, state?: GameState): void;
  startDungeon(dungeonId: string, partyCharIds: string[]): void;
  abandonDungeon(charId: string): void;
}

/** Dungeon session orchestration and party restore flow. */
export function createDungeonGameplay(
  runtime: SessionRuntime,
): DungeonGameplay {
  type SavedActivitySnapshot = PlayerCharacter["activity"];

  function restoreDungeonParty(
    dungeonSessionId: string,
    state: GameState = runtime.state,
  ): void {
    const dungeonSession = state.dungeons[dungeonSessionId];
    if (!dungeonSession) return;

    for (const charId of dungeonSession.partyCharIds) {
      const cc = runtime.characters.get(charId);
      if (!cc) continue;
      const saved = dungeonSession.savedActivities[charId];
      if (cc._activity) {
        runtime.engine.unregister(cc._activity.id);
        cc._activity = null;
      }
      cc.hero.activity = saved?.activity ?? null;
      cc.hero.locationId = saved?.locationId ?? null;
      cc.hero.stageId = saved?.stageId ?? null;
      cc.hero.dungeonSessionId = null;
      // Note: we do NOT restore old stage controllers or activities here.
      // The character returns to idle at their saved location. If they had an
      // activity before, it was snapshot'd as data; we'd need rehydration to
      // actually resume it. For alpha, just restoring location is sufficient.
      // Clear the persisted activity since we can't seamlessly resume it.
      cc.hero.activity = null;
      cc.hero.stageId = null;
    }

    const stageId = dungeonSession.stageId;
    const ctrl = runtime.stageControllers.get(stageId);
    if (ctrl) {
      runtime.engine.unregister(ctrl.id);
      runtime.stageControllers.delete(stageId);
    }
    leaveStageCore(stageId, runtime.buildCtx());

    const dungeonActivity = runtime.dungeonActivities.get(dungeonSessionId);
    if (dungeonActivity) {
      runtime.engine.unregister(dungeonActivity.id);
      runtime.dungeonActivities.delete(dungeonSessionId);
    }

    delete state.dungeons[dungeonSessionId];
  }

  return {
    restoreDungeonParty,

    startDungeon(dungeonId, partyCharIds) {
      const def = getDungeon(dungeonId);
      if (partyCharIds.length === 0) {
        throw new Error("session.startDungeon: partyCharIds must not be empty");
      }
      if (def.minPartySize && partyCharIds.length < def.minPartySize) {
        throw new Error(
          `session.startDungeon: need at least ${def.minPartySize} characters, got ${partyCharIds.length}`,
        );
      }
      if (def.maxPartySize && partyCharIds.length > def.maxPartySize) {
        throw new Error(
          `session.startDungeon: max ${def.maxPartySize} characters, got ${partyCharIds.length}`,
        );
      }

      const ccs = partyCharIds.map((charId) => {
        const cc = runtime.characters.get(charId);
        if (!cc) {
          throw new Error(`session.startDungeon: no character "${charId}"`);
        }
        return cc;
      });

      const savedActivities: Record<
        string,
        {
          locationId: string | null;
          stageId: string | null;
          activity: SavedActivitySnapshot;
        }
      > = {};
      for (const cc of ccs) {
        savedActivities[cc.hero.id] = {
          locationId: cc.hero.locationId,
          stageId: cc.hero.stageId,
          activity: cc.hero.activity
            ? { ...cc.hero.activity, data: { ...cc.hero.activity.data } }
            : null,
        };
        tearDownCharInstance(runtime, cc, "switch_activity");
      }

      const stageId = mintStageId(runtime.state);
      const locationId = `dungeon.${dungeonId}`;
      const dungeonSessionId = mintDungeonSessionId(runtime.state);

      const ctrl = enterStageCore({
        stageId,
        locationId,
        mode: { kind: "dungeon", dungeonSessionId },
        ctxProvider: runtime.buildCtx,
      });
      runtime.stageControllers.set(stageId, ctrl);
      runtime.engine.register(ctrl);

      const dungeonSession: DungeonSession = {
        dungeonId,
        partyCharIds: partyCharIds.slice(),
        savedActivities,
        currentWaveIndex: 0,
        status: "in_progress",
        phase: "spawningWave",
        transitionTick: runtime.engine.currentTick,
        startedAtTick: runtime.engine.currentTick,
        stageId,
      };
      runtime.state.dungeons[dungeonSessionId] = dungeonSession;

      for (const cc of ccs) {
        cc.hero.locationId = locationId;
        cc.hero.stageId = stageId;
        cc.hero.dungeonSessionId = dungeonSessionId;
        cc.hero.activity = {
          kind: ACTIVITY_DUNGEON_KIND,
          startedAtTick: runtime.engine.currentTick,
          data: {
            dungeonSessionId,
            phase: "spawningWave",
            currentBattleId: null,
            transitionTick: runtime.engine.currentTick,
          },
        };
      }

      const dungeonActivity = createDungeonActivity({
        dungeonSessionId,
        ctxProvider: runtime.buildCtx,
        restoreParty: () => restoreDungeonParty(dungeonSessionId, runtime.state),
      });
      runtime.dungeonActivities.set(dungeonSessionId, dungeonActivity);
      runtime.engine.register(dungeonActivity);

      runtime.bus.emit("activityStarted", {
        charId: partyCharIds[0]!,
        kind: "dungeon",
        locationId,
        stageId,
        dungeonSessionId,
        dungeonId,
      });
    },

    abandonDungeon(charId) {
      const cc = runtime.characters.get(charId);
      if (!cc) {
        throw new Error(`session.abandonDungeon: no character "${charId}"`);
      }
      const dungeonSessionId = cc.hero.dungeonSessionId;
      if (!dungeonSessionId) {
        throw new Error(
          `session.abandonDungeon: character "${charId}" is not in a dungeon`,
        );
      }
      const dungeonSession = runtime.state.dungeons[dungeonSessionId];
      if (!dungeonSession) {
        throw new Error(
          `session.abandonDungeon: no dungeon session "${dungeonSessionId}"`,
        );
      }
      const dungeonActivity = runtime.dungeonActivities.get(dungeonSessionId);
      if (dungeonActivity) {
        abandonDungeonCore(
          dungeonActivity,
          dungeonSession,
          runtime.buildCtx(),
          () => restoreDungeonParty(dungeonSessionId, runtime.state),
        );
        return;
      }

      restoreDungeonParty(dungeonSessionId, runtime.state);
    },
  };
}

import { getLocation } from "../../content";
import { createGatherActivity } from "../../world/activity";
import {
  findSpawnedResourceNodeActorId,
  startStageInstance,
  tearDownCharInstance,
} from "../runtime";
import type { CharacterCommandSet, SessionRuntime } from "../types";

interface CharacterGameplayDeps {
  startPartyCombat(combatZoneId: string, partyCharIds: string[]): void;
}

/**
 * Character gameplay service: location entry/exit + basic activity switching.
 *
 * These commands are still per-hero, but the actual implementation lives here
 * instead of bloating CharacterController itself.
 */
export function createCharacterGameplay(
  runtime: SessionRuntime,
  deps: CharacterGameplayDeps,
): Pick<
  CharacterCommandSet,
  | "enterLocation"
  | "leaveLocation"
  | "startFight"
  | "startGather"
  | "stopActivity"
> {
  return {
    enterLocation(cc, locationId) {
      getLocation(locationId);
      const previousLocationId = cc.hero.locationId;
      tearDownCharInstance(runtime, cc, "left_location");
      cc.hero.locationId = locationId;
      if (previousLocationId && previousLocationId !== locationId) {
        runtime.bus.emit("locationLeft", {
          charId: cc.hero.id,
          locationId: previousLocationId,
        });
      }
      if (previousLocationId !== locationId) {
        runtime.bus.emit("locationEntered", {
          charId: cc.hero.id,
          locationId,
        });
      }
    },

    leaveLocation(cc) {
      const previousLocationId = cc.hero.locationId;
      tearDownCharInstance(runtime, cc, "left_location");
      cc.hero.locationId = null;
      if (previousLocationId) {
        runtime.bus.emit("locationLeft", {
          charId: cc.hero.id,
          locationId: previousLocationId,
        });
      }
    },

    startFight(cc, combatZoneId) {
      if (!cc.hero.locationId) {
        console.warn("session.startFight: not in a location");
        return;
      }
      deps.startPartyCombat(combatZoneId, [cc.hero.id]);
    },

    startGather(cc, nodeDefId) {
      if (!cc.hero.locationId) {
        console.warn("session.startGather: not in a location");
        return;
      }
      const locationId = cc.hero.locationId;
      const stageId = startStageInstance(runtime, cc, {
        locationId,
        resourceNodes: [nodeDefId],
      });
      const nodeActorId = findSpawnedResourceNodeActorId(runtime, stageId, nodeDefId);
      cc._activity = createGatherActivity({
        ownerCharacterId: cc.hero.id,
        nodeId: nodeActorId,
        ctxProvider: runtime.buildCtx,
      });
      runtime.engine.register(cc._activity);
      runtime.bus.emit("activityStarted", {
        charId: cc.hero.id,
        kind: "gather",
        locationId,
        stageId,
        resourceNodeId: nodeDefId,
      });
    },

    stopActivity(cc) {
      tearDownCharInstance(runtime, cc, "player");
    },
  };
}

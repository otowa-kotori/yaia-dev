import { getCombatZone } from "../../content";
import {
  ACTIVITY_COMBAT_KIND,
  createCombatActivity,
} from "../../world/activity";
import { enterStage as enterStageCore } from "../../world/stage";
import { mintStageId } from "../../runtime-ids";
import { tearDownCharInstance } from "../runtime";
import type { SessionRuntime } from "../types";

export interface PartyCombatGameplay {
  startPartyCombat(combatZoneId: string, partyCharIds: string[]): void;
}

/** Shared stage + shared combat-activity orchestration for party combat. */
export function createPartyCombatGameplay(
  runtime: SessionRuntime,
): PartyCombatGameplay {
  return {
    startPartyCombat(combatZoneId, partyCharIds) {
      const def = getCombatZone(combatZoneId);
      if (partyCharIds.length === 0) {
        throw new Error(
          "session.startPartyCombat: partyCharIds must not be empty",
        );
      }
      if (def.minPartySize && partyCharIds.length < def.minPartySize) {
        throw new Error(
          `session.startPartyCombat: need at least ${def.minPartySize} characters, got ${partyCharIds.length}`,
        );
      }
      if (def.maxPartySize && partyCharIds.length > def.maxPartySize) {
        throw new Error(
          `session.startPartyCombat: max ${def.maxPartySize} characters, got ${partyCharIds.length}`,
        );
      }

      const ccs = partyCharIds.map((charId) => {
        const cc = runtime.characters.get(charId);
        if (!cc) {
          throw new Error(`session.startPartyCombat: no character "${charId}"`);
        }
        return cc;
      });

      const locationId = ccs[0]!.hero.locationId;
      if (!locationId) {
        throw new Error(
          "session.startPartyCombat: first character not in a location",
        );
      }

      for (const cc of ccs) {
        tearDownCharInstance(runtime, cc, "switch_activity");
      }

      const stageId = mintStageId(runtime.state);
      const ctrl = enterStageCore({
        stageId,
        locationId,
        mode: { kind: "combatZone", combatZoneId },
        ctxProvider: runtime.buildCtx,
      });
      runtime.stageControllers.set(stageId, ctrl);
      runtime.engine.register(ctrl);

      for (const cc of ccs) {
        cc.hero.stageId = stageId;
      }

      const combatActivity = createCombatActivity({
        stageId,
        partyCharIds: partyCharIds.slice(),
        ctxProvider: runtime.buildCtx,
      });
      combatActivity.onStart?.(runtime.buildCtx());
      runtime.combatActivities.set(stageId, combatActivity);
      runtime.engine.register(combatActivity);

      for (const cc of ccs) {
        cc._activity = combatActivity;
      }

      runtime.bus.emit("activityStarted", {
        charId: partyCharIds[0]!,
        kind: "combat",
        locationId,
        stageId,
        combatZoneId,
      });

    },
  };
}

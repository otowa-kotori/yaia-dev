import type { CombatZoneDef, CombatZoneId } from "../../core/content";
import { compileInheritedCollection, type AuthoringDef } from "../compiler/inheritance";
import {
  tutorialSlime,
  slime,
  wildBoar,
  armoredBear,
} from "./monsters";

// Phase 0：单一地点，4 个战斗区域，每关一种怪物，单人进入。

export const stage1Tutorial: CombatZoneDef = {
  id: "combatzone.phase0.stage1" as CombatZoneId,
  name: "第一关：教学",
  waveSelection: "random",
  minPartySize: 1,
  maxPartySize: 1,
  waves: [{ monsters: [tutorialSlime.id] }],
};

export const stage2Normal: CombatZoneDef = {
  id: "combatzone.phase0.stage2" as CombatZoneId,
  name: "第二关：正常",
  waveSelection: "random",
  minPartySize: 1,
  maxPartySize: 1,
  waves: [{ monsters: [slime.id] }],
};

export const stage3Strong: CombatZoneDef = {
  id: "combatzone.phase0.stage3" as CombatZoneId,
  name: "第三关：较强",
  waveSelection: "random",
  minPartySize: 1,
  maxPartySize: 1,
  waves: [{ monsters: [wildBoar.id] }],
};

export const stage4Hard: CombatZoneDef = {
  id: "combatzone.phase0.stage4" as CombatZoneId,
  name: "第四关：强",
  waveSelection: "random",
  minPartySize: 1,
  maxPartySize: 1,
  waves: [{ monsters: [armoredBear.id] }],
};

const authoredCombatZones = {
  [stage1Tutorial.id]: stage1Tutorial,
  [stage2Normal.id]: stage2Normal,
  [stage3Strong.id]: stage3Strong,
  [stage4Hard.id]: stage4Hard,
} satisfies Record<string, AuthoringDef<CombatZoneDef>>;

export const combatZones = compileInheritedCollection<CombatZoneDef>({
  bucketName: "combatZones",
  defs: authoredCombatZones,
});

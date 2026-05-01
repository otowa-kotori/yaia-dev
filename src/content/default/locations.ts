import type { LocationDef, LocationId } from "../../core/content";
import { compileInheritedCollection, type AuthoringDef } from "../compiler/inheritance";
import {
  stage1Tutorial,
  stage2Normal,
  stage3Strong,
  stage4Hard,
} from "./combat-zones";

// Phase 0：单一地点，4 个战斗关卡入口。

export const prairieLocation: LocationDef = {
  id: "location.prairie" as LocationId,
  name: "翠风草原",
  entries: [
    { kind: "combat", combatZoneId: stage1Tutorial.id, label: "第一关" },
    { kind: "combat", combatZoneId: stage2Normal.id, label: "第二关" },
    { kind: "combat", combatZoneId: stage3Strong.id, label: "第三关" },
    { kind: "combat", combatZoneId: stage4Hard.id, label: "第四关" },
  ],
};

const authoredLocations = {
  [prairieLocation.id]: prairieLocation,
} satisfies Record<string, AuthoringDef<LocationDef>>;

export const locations = compileInheritedCollection<LocationDef>({
  bucketName: "locations",
  defs: authoredLocations,
});

import type { ResourceNodeDef, ResourceNodeId } from "../../core/content";
import { compileInheritedCollection, type AuthoringDef } from "../compiler/inheritance";
import { copperOre } from "./items";
import { miningSkill } from "./skills";

export const copperVein: ResourceNodeDef = {
  id: "node.copper_vein" as ResourceNodeId,
  name: "铜矿脉",
  skill: miningSkill.id,
  swingTicks: 10,
  xpPerSwing: 4,
  drops: [{ itemId: copperOre.id, chance: 1, minQty: 1, maxQty: 1 }],
};

const authoredResourceNodes = {
  [copperVein.id]: copperVein,
} satisfies Record<string, AuthoringDef<ResourceNodeDef>>;

export const resourceNodes = compileInheritedCollection<ResourceNodeDef>({
  bucketName: "resourceNodes",
  defs: authoredResourceNodes,
});

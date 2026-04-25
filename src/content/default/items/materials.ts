import type { ItemDef, ItemId } from "../../../core/content";
import type { AuthoringDef } from "../../compiler/inheritance";

export const itemMaterialDrafts = {
  "item.ore.copper": {
    id: "item.ore.copper" as ItemId,
    extends: "item.template.material.ore",
    name: "铜矿石",
    description: "刚挖出来的粗铜矿石，是最基础的金属材料之一。",
  },
  "item.monster.slime_gel": {
    id: "item.monster.slime_gel" as ItemId,
    extends: "item.template.material.monster_drop",
    name: "史莱姆胶",
    description: "一团黏糊糊的史莱姆胶，常用来当作低阶黏结材料。",
  },
} satisfies Record<string, AuthoringDef<ItemDef>>;

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
  "item.monster.beast_hide": {
    id: "item.monster.beast_hide" as ItemId,
    extends: "item.template.material.monster_drop",
    name: "兽皮",
    description: "从野猪和角兔身上剥下的厚皮，是最基础的防具材料。",
  },
  "item.monster.twilight_essence": {
    id: "item.monster.twilight_essence" as ItemId,
    extends: "item.template.material.monster_drop",
    name: "暗木精华",
    description: "暮色林地怪物体内凝出的暗色树脂，可作低阶武器辅材。",
  },
  "item.monster.bone_dust": {
    id: "item.monster.bone_dust" as ItemId,
    extends: "item.template.material.monster_drop",
    name: "骨粉",
    description: "骸骨兵散落后留下的碎骨粉末，常用于强化重甲和武器。",
  },
  "item.monster.wolf_king_fang": {
    id: "item.monster.wolf_king_fang" as ItemId,
    extends: "item.template.material.monster_drop",
    name: "狼王牙",
    description: "只有狼穴深处的精英巨狼才会掉落的完整獠牙。",
  },
  "item.monster.carapace": {
    id: "item.monster.carapace" as ItemId,
    extends: "item.template.material.monster_drop",
    name: "矿虫甲壳",
    description: "矿坑生物外壳上剥落的坚硬甲片，是中后期防具的重要来源。",
  },
  "item.monster.shadow_core": {
    id: "item.monster.shadow_core" as ItemId,
    extends: "item.template.material.monster_drop",
    name: "暗影核",
    description: "暗影魔死后残留的黑色核心，蕴含浓缩的魔力波动。",
  },
  "item.monster.boss_core": {
    id: "item.monster.boss_core" as ItemId,
    extends: "item.template.material.monster_drop",
    name: "Boss核心",
    description: "首领体内析出的高密度核心，是新手阶段的顶级战利品。",
  },
} satisfies Record<string, AuthoringDef<ItemDef>>;

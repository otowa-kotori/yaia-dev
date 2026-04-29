// 角色属性基线——英雄和怪物共享的数值锚点。
//
// 设计目标：标准怪物 ≈ 4 职业平均值。英雄在此基线上按职业偏科，
// 怪物在此基线上按特色偏移。两边 import 同一份常量，保证同级平衡。
//
// baseAttrs: Lv1 时的属性值。
// growth:    每级增量（和 HeroConfig.growth / MonsterDef.growth 同语义）。
//
// 这些值约等于 4 个英雄的加权平均。精确值在实测时微调。

import type { AttrId } from "../../core/content/types";
import { ATTR } from "../../core/entity/attribute";

/** Lv1 标准角色属性值。 */
export const BASE_ATTRS: Partial<Record<AttrId, number>> = {
  [ATTR.MAX_HP]: 75,
  [ATTR.MAX_MP]: 30,
  [ATTR.STR]:    15,
  [ATTR.DEX]:    15,
  [ATTR.INT]:    10,
  [ATTR.CON]:    15,
  [ATTR.WEAPON_ATK]: 6,
  [ATTR.PDEF]:   0,
  [ATTR.MRES]:   0,
  [ATTR.SPEED]:  40,
};

/** 每级标准成长（≈ 4 职业平均成长）。 */
export const BASE_GROWTH: Partial<Record<AttrId, number>> = {
  [ATTR.MAX_HP]: 25,
  [ATTR.MAX_MP]: 3,
  [ATTR.STR]:    5,
  [ATTR.DEX]:    4,
  [ATTR.INT]:    3,
  [ATTR.CON]:    4,
  [ATTR.WEAPON_ATK]: 2,
  [ATTR.PDEF]:   2,
};

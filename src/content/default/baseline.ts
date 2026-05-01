// 角色属性基线——英雄和怪物共享的数值锚点。
//
// 设计目标：标准怪物 ≈ 3 角色平均值。英雄在此基线上按路线偏科，
// 怪物在此基线上按特色偏移。两边 import 同一份常量，保证同级平衡。
//
// baseAttrs: Lv1 时的属性值（= 成长 × 2）。
// growth:    每级增量（和 HeroConfig.growth / MonsterDef.growth 同语义）。
//
// Phase 0 基线：三围成长各 10，HP 每级 50（CON×3=30 + 直接 20）。

import type { AttrId } from "../../core/content/types";
import { ATTR } from "../../core/entity/attribute";

/** Lv1 标准角色属性值（= 成长 × 2）。 */
export const BASE_ATTRS: Partial<Record<AttrId, number>> = {
  [ATTR.MAX_HP]: 100,
  [ATTR.MAX_MP]: 30,
  [ATTR.STR]:    20,
  [ATTR.DEX]:    20,
  [ATTR.INT]:    20,
  [ATTR.CON]:    20,
  [ATTR.WEAPON_ATK]: 6,
  [ATTR.PDEF]:   0,
  [ATTR.MRES]:   0,
  [ATTR.SPEED]:  40,
};

/** 每级标准成长（= 三角色平均）。 */
export const BASE_GROWTH: Partial<Record<AttrId, number>> = {
  [ATTR.MAX_HP]: 20,
  [ATTR.MAX_MP]: 3,
  [ATTR.STR]:    10,
  [ATTR.DEX]:    10,
  [ATTR.INT]:    10,
  [ATTR.CON]:    10,
};

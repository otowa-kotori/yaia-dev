import { ATTR } from "../../core/entity/attribute";
import type { AttrDef } from "../../core/content";
import { DEFAULT_CHAR_STACK_LIMIT } from "../../core/inventory";
import { compileInheritedCollection, type AuthoringDef } from "../compiler/inheritance";

// 属性分层（完整说明见 docs/design/combat-formula.md §1）：
//   一级属性: STR / DEX / INT / CON
//   聚合层:   PHYS_POTENCY / MAG_POTENCY（DynamicModifierProvider 汇聚一级属性）
//   面板层:   PATK / MATK（computeBase 派生，依赖武器值 + 聚合层）
//   防御层:   PDEF（装备 flat）/ MRES（百分比减伤 0–0.8）
//   武器层:   WEAPON_ATK / WEAPON_MATK（装备 flat，赤手默认 1 / 0）
//   命中层:   HIT / EVA（DEX DynamicModifierProvider 驱动）
//   暴击层:   CRIT_RATE / CRIT_RES（DEX DynamicModifierProvider 驱动）
//
// k=0.03 是线性缩放系数，决定主属性对面板攻击力的放大幅度。
// PATK = WEAPON_ATK × (1 + K_SCALING × PHYS_POTENCY)
// 全部设计验证见 docs/design/combat-formula.md。

const K_SCALING = 0.03;

const authoredAttributes = {
  [ATTR.MAX_HP]: {
    id: ATTR.MAX_HP,
    name: "生命上限",
    defaultBase: 50,
    integer: true,
    clampMin: 0,
  },
  [ATTR.MAX_MP]: {
    id: ATTR.MAX_MP,
    name: "魔力上限",
    defaultBase: 10,
    integer: true,
    clampMin: 0,
  },
  [ATTR.HP_REGEN]: {
    id: ATTR.HP_REGEN,
    name: "生命回复",
    defaultBase: 0,
    clampMin: 0,
  },
  [ATTR.MP_REGEN]: {
    id: ATTR.MP_REGEN,
    name: "法力回复",
    defaultBase: 0,
    clampMin: 0,
  },
  [ATTR.OUT_OF_COMBAT_HP_PCT_PER_SECOND]: {
    id: ATTR.OUT_OF_COMBAT_HP_PCT_PER_SECOND,
    name: "脱战每秒生命恢复比例",
    defaultBase: 0,
    clampMin: 0,
  },
  [ATTR.OUT_OF_COMBAT_MP_PCT_PER_SECOND]: {
    id: ATTR.OUT_OF_COMBAT_MP_PCT_PER_SECOND,
    name: "脱战每秒法力恢复比例",
    defaultBase: 0,
    clampMin: 0,
  },
  [ATTR.STR]: { id: ATTR.STR, name: "力量", defaultBase: 5, integer: true },
  [ATTR.DEX]: { id: ATTR.DEX, name: "敏捷", defaultBase: 5, integer: true },
  [ATTR.INT]: { id: ATTR.INT, name: "智力", defaultBase: 5, integer: true },
  [ATTR.CON]: { id: ATTR.CON, name: "体质", defaultBase: 5, integer: true },
  [ATTR.SPEED]: {
    id: ATTR.SPEED,
    name: "速度",
    defaultBase: 40,
    integer: true,
    clampMin: 1,
  },
  [ATTR.WEAPON_ATK]: {
    id: ATTR.WEAPON_ATK,
    name: "武器攻击",
    defaultBase: 4,
    integer: true,
    clampMin: 0,
  },
  [ATTR.WEAPON_MATK]: {
    id: ATTR.WEAPON_MATK,
    name: "武器法攻",
    defaultBase: 0,
    integer: true,
    clampMin: 0,
  },
  [ATTR.PHYS_POTENCY]: {
    id: ATTR.PHYS_POTENCY,
    name: "物理潜力",
    defaultBase: 0,
    clampMin: 0,
  },
  [ATTR.MAG_POTENCY]: {
    id: ATTR.MAG_POTENCY,
    name: "魔法潜力",
    defaultBase: 0,
    clampMin: 0,
  },
  [ATTR.PATK]: {
    id: ATTR.PATK,
    name: "物理攻击力",
    defaultBase: 0,
    integer: true,
    clampMin: 0,
    computeBase: (get) =>
      get(ATTR.WEAPON_ATK) * (1 + K_SCALING * get(ATTR.PHYS_POTENCY)),
    dependsOn: [ATTR.WEAPON_ATK, ATTR.PHYS_POTENCY],
  },
  [ATTR.MATK]: {
    id: ATTR.MATK,
    name: "魔法攻击力",
    defaultBase: 0,
    integer: true,
    clampMin: 0,
    computeBase: (get) =>
      get(ATTR.WEAPON_MATK) * (1 + K_SCALING * get(ATTR.MAG_POTENCY)),
    dependsOn: [ATTR.WEAPON_MATK, ATTR.MAG_POTENCY],
  },
  [ATTR.PDEF]: {
    id: ATTR.PDEF,
    name: "物理防御",
    defaultBase: 0,
    integer: true,
    clampMin: 0,
  },
  [ATTR.MRES]: {
    id: ATTR.MRES,
    name: "魔法抗性",
    defaultBase: 0,
    clampMin: 0,
    clampMax: 0.8,
  },
  [ATTR.HIT]: {
    id: ATTR.HIT,
    name: "命中",
    defaultBase: 0,
    integer: true,
    clampMin: 0,
  },
  [ATTR.EVA]: {
    id: ATTR.EVA,
    name: "闪避",
    defaultBase: 0,
    integer: true,
    clampMin: 0,
  },
  [ATTR.CRIT_RATE]: {
    id: ATTR.CRIT_RATE,
    name: "暴击",
    defaultBase: 0,
    integer: true,
    clampMin: 0,
    // 现在是原始评级值（由 DEX 通过 UNIVERSAL_SCALING 驱动），
    // 实际暴击概率由 crit_rate_v1 公式在结算时计算。
  },
  [ATTR.CRIT_RES]: {
    id: ATTR.CRIT_RES,
    name: "暴击抗性",
    defaultBase: 0,
    integer: true,
    clampMin: 0,
  },
  [ATTR.CRIT_MULT]: {
    id: ATTR.CRIT_MULT,
    name: "暴击倍率",
    defaultBase: 1.5,
    clampMin: 1,
  },
  [ATTR.INVENTORY_STACK_LIMIT]: {
    id: ATTR.INVENTORY_STACK_LIMIT,
    name: "背包堆叠上限",
    defaultBase: DEFAULT_CHAR_STACK_LIMIT,
    integer: true,
    clampMin: 1,
  },
  [ATTR.AGGRO_WEIGHT]: {
    id: ATTR.AGGRO_WEIGHT,
    name: "仇恨权重",
    defaultBase: 1.0,
    clampMin: 0.1,
  },
  [ATTR.TALENT_SLOTS]: {
    id: ATTR.TALENT_SLOTS,
    name: "技能槽",
    defaultBase: 3,
    integer: true,
    clampMin: 1,
  },
} satisfies Record<string, AuthoringDef<AttrDef>>;

export const attrDefs = compileInheritedCollection<AttrDef>({
  bucketName: "attributes",
  defs: authoredAttributes,
});

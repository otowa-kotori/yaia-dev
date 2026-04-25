import { ATTR } from "../../core/entity/attribute";
import type { AttrDef } from "../../core/content";
import { DEFAULT_CHAR_STACK_LIMIT } from "../../core/inventory";
import { compileInheritedCollection, type AuthoringDef } from "../compiler/inheritance";

// 属性分层（完整说明见 docs/design/plan-combat-damage-and-growth.md §1）：
//   一级属性: STR / DEX / INT
//   聚合层:   PHYS_POTENCY / MAG_POTENCY（DynamicModifierProvider 汇聚一级属性）
//   面板层:   PATK / MATK（computeBase 派生，依赖武器值 + 聚合层）
//   防御层:   PDEF（装备 flat）/ MRES（百分比减伤 0–0.8）
//   武器层:   WEAPON_ATK / WEAPON_MATK（装备 flat，赤手默认 1 / 0）
//
// k=0.3 是 sqrt 缩放系数，决定主属性对面板攻击力的放大幅度。
// 全部设计验证见 docs/design/combat-formula.md。

const K_SCALING = 0.3;

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
  [ATTR.STR]: { id: ATTR.STR, name: "力量", defaultBase: 5, integer: true },
  [ATTR.DEX]: { id: ATTR.DEX, name: "敏捷", defaultBase: 5, integer: true },
  [ATTR.INT]: { id: ATTR.INT, name: "智力", defaultBase: 5, integer: true },
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
      get(ATTR.WEAPON_ATK) * (1 + K_SCALING * Math.sqrt(get(ATTR.PHYS_POTENCY))),
    dependsOn: [ATTR.WEAPON_ATK, ATTR.PHYS_POTENCY],
  },
  [ATTR.MATK]: {
    id: ATTR.MATK,
    name: "魔法攻击力",
    defaultBase: 0,
    integer: true,
    clampMin: 0,
    computeBase: (get) =>
      get(ATTR.WEAPON_MATK) * (1 + K_SCALING * Math.sqrt(get(ATTR.MAG_POTENCY))),
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
  [ATTR.CRIT_RATE]: {
    id: ATTR.CRIT_RATE,
    name: "暴击率",
    defaultBase: 0,
    clampMin: 0,
    clampMax: 1,
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
} satisfies Record<string, AuthoringDef<AttrDef>>;

export const attrDefs = compileInheritedCollection<AttrDef>({
  bucketName: "attributes",
  defs: authoredAttributes,
});

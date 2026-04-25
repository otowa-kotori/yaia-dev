import type { UpgradeDef } from "../../core/content";
import { ATTR } from "../../core/entity/attribute";
import { compileInheritedCollection, type AuthoringDef } from "../compiler/inheritance";
import { CURRENCY_GOLD } from "./currencies";

// Purchased via WorldRecord. Cost scales using exp_curve_v1 so the same
// formula evaluator handles both character XP and upgrade pricing.
//
// 战士训练: WEAPON_ATK flat +2，10 级上限
//   Cost: 50 / 80 / 128 / 205 / 328 / 524 / 839 / 1342 / 2147 / 3436
// 护甲强化: PDEF flat +1，10 级上限
//   Cost: 40 / 60 / 90 / 135 / 202 / 304 / 455 / 683 / 1024 / 1536

export const atkUpgrade: UpgradeDef = {
  id: "upgrade.combat.atk",
  name: "战士训练",
  description: "永久提升所有角色武器攻击力 +2",
  maxLevel: 10,
  modifierPerLevel: [
    { stat: ATTR.WEAPON_ATK, op: "flat", value: 2, sourceId: "world.upgrade.combat.atk" },
  ],
  costCurrency: CURRENCY_GOLD,
  costScaling: { kind: "exp_curve_v1", base: 50, growth: 1.6 },
};

export const defUpgrade: UpgradeDef = {
  id: "upgrade.combat.def",
  name: "护甲强化",
  description: "永久提升所有角色物理防御 +1",
  maxLevel: 10,
  modifierPerLevel: [
    { stat: ATTR.PDEF, op: "flat", value: 1, sourceId: "world.upgrade.combat.def" },
  ],
  costCurrency: CURRENCY_GOLD,
  costScaling: { kind: "exp_curve_v1", base: 40, growth: 1.5 },
};

const authoredUpgrades = {
  [atkUpgrade.id]: atkUpgrade,
  [defUpgrade.id]: defUpgrade,
} satisfies Record<string, AuthoringDef<UpgradeDef>>;

export const upgrades = compileInheritedCollection<UpgradeDef>({
  bucketName: "upgrades",
  defs: authoredUpgrades,
});

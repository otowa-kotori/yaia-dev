// 全角色通用属性派生配置。
//
// 这些 provider 在 rebuildCharacterDerived() 中对所有 Character
// 无条件安装，不区分玩家/怪物（人怪同模）。
//
// physScaling / magScaling 是角色特定的（来自 HeroConfig / MonsterDef），
// 不在此列——它们仍在 rebuildCharacterDerived 中按角色配置安装。
//
// 调参只改此文件。rebuildCharacterDerived 遍历 UNIVERSAL_SCALING，
// 为每条创建一个 DynamicModifierProvider。

import type { AttrId } from "../../content/types";
import { ATTR } from "./index";

/**
 * 一条通用属性缩放配置。
 *
 * 语义：sourceAttr 的最终值 × ratio → 作为 flat modifier 加到 targetAttr。
 * 例如 CON × 3 → MAX_HP。
 */
export interface UniversalScalingEntry {
  /** DynamicModifierProvider 的 sourceId，用于安装/移除/调试。 */
  sourceId: string;
  /** 读取哪个属性作为输入。 */
  sourceAttr: AttrId;
  /** 输出到哪个属性。 */
  targetAttr: AttrId;
  /** 输入值的乘数。 */
  ratio: number;
}

/**
 * 全角色无条件安装的属性派生列表。
 *
 * 同 DEX 时的命中 / 暴击率由公式系统 k 系数控制，这里只负责
 * "DEX → HIT/EVA/CRIT_RATE/CRIT_RES 的 1:1 映射"。
 */
export const UNIVERSAL_SCALING: readonly UniversalScalingEntry[] = [
  // CON → MAX_HP：每点体质 = 3 点生命上限
  { sourceId: "con_hp_scaling",       sourceAttr: ATTR.CON, targetAttr: ATTR.MAX_HP,    ratio: 3 },

  // DEX → 命中 / 闪避（1:1）
  { sourceId: "dex_hit_scaling",      sourceAttr: ATTR.DEX, targetAttr: ATTR.HIT,       ratio: 1.0 },
  { sourceId: "dex_eva_scaling",      sourceAttr: ATTR.DEX, targetAttr: ATTR.EVA,       ratio: 1.0 },

  // DEX → 暴击 / 暴击抗性（1:1）
  { sourceId: "dex_crit_scaling",     sourceAttr: ATTR.DEX, targetAttr: ATTR.CRIT_RATE, ratio: 1.0 },
  { sourceId: "dex_crit_res_scaling", sourceAttr: ATTR.DEX, targetAttr: ATTR.CRIT_RES,  ratio: 1.0 },
];

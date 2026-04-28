// Economy types — 统一开销与奖励的数据定义。
//
// 设计原则：
//   - CostDef     描述"花什么"：货币 + 堆叠材料（不含 MP/TP/GearInstance）。
//   - RewardBundle 描述"得什么"：保底物品（items）+ 摇号掉落（drops）+
//                 货币 + 角色经验 + 技能经验。
//   - LootEntry   是摇号桶的一行。爆率加成只作用于 drops，不影响 items。
//   - ItemGrant   是确定发放的一行（qty 固定，不摇号）。
//
// 多人分配语义（由 loot.ts 的 distributeRewards 实现）：
//   - 货币 / charXp / skillXp：floor(总量 / 人数)，余数随机给一人。
//   - items（保底）：整批随机给一人。
//   - drops（摇号）：每人各自独立摇，effectiveChance = entry.chance / partySize。
//
// loot 分配模式通过 LootDistributionMode 预留扩展点。
// 当前只有 "random_member"；未来支持共享背包时可新增模式，不破坏旧逻辑。

import type { ItemId, SkillId } from "../content/types";

// ---------- 基础条目 ----------

/** 摇号掉落条目。爆率加成（dropRateMod）作用于 chance 字段。 */
export interface LootEntry {
  itemId: ItemId;
  /** 基础概率 0..1。运行时通过 dropRateMod 缩放，超出 1.0 时 clamp。 */
  chance: number;
  minQty: number;
  maxQty: number;
}

/** 确定发放条目。qty 固定，不受爆率影响。 */
export interface ItemGrant {
  itemId: ItemId;
  qty: number;
}

// ---------- 奖励束 ----------

/** 统一奖励束。包含确定发放和摇号两个分支，以及经验与货币。 */
export interface RewardBundle {
  /** 保底物品：每次一定发放，不受爆率影响。 */
  items?: ItemGrant[];
  /** 摇号掉落：每条按 chance 独立摇号，受爆率加成影响。 */
  drops?: LootEntry[];
  /** 货币奖励。key = currency id（如 "currency.gold"）。 */
  currencies?: Record<string, number>;
  /** 技能经验奖励。 */
  xp?: { skillId: SkillId; amount: number }[];
  /** 角色经验奖励。 */
  charXp?: number;
}

// ---------- 开销 ----------

/** 统一开销。只管游戏外资源：货币与堆叠材料。
 *
 *  不在此处：
 *  - MP / TP：战斗/天赋系统各自处理。
 *  - GearInstance（装备实例）：由调用方在执行前单独校验和移除。
 */
export interface CostDef {
  /** 货币消耗。key = currency id。 */
  currencies?: Record<string, number>;
  /** 堆叠材料消耗（仅 stackable=true 物品）。 */
  items?: ItemGrant[];
}

// ---------- 摇号结果 ----------

/** rollDrops 的返回值：已经确定数量的掉落列表，可直接走 grantRewards。 */
export type RolledItems = ItemGrant[];

// ---------- Loot 分配模式 ----------

/**
 * 多人 loot 分配模式。
 * 当前只支持 "random_member"（道具随机给一人）。
 * 未来换成共享背包时，添加新模式值而不修改现有逻辑。
 */
export type LootDistributionMode = "random_member"; // | "shared_inventory" 未来

// ---------- 奖励来源标签 ----------

/** 用于 grantRewards 的来源标签，供 game-log 区分奖励来源。 */
export type RewardSourceKind =
  | "kill"
  | "wave"
  | "dungeon_wave"
  | "dungeon_completion"
  | "craft"
  | "gather"
  | "other";

export interface RewardSource {
  kind: RewardSourceKind;
  /** 来源实体 id，如怪物 defId / 副本 id / 配方 id 等。 */
  id: string;
}

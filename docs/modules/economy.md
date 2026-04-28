# economy

通用开销与奖励模块。统一各类开销（升级、制作、强化）和各类奖励（击杀、波次、副本、制作）的数据类型与发放逻辑。

## 定位

此前项目中开销与奖励的数据结构各自独立，分散在 `MonsterDef`、`WaveRewardDef`、`EffectDef.rewards`、`RecipeDef` 等处，且多人分配逻辑内联在 `CombatActivity` 里。`economy` 模块将这些统一为两个核心原语：

- **`CostDef`**：描述"花什么"（货币 + 堆叠材料）
- **`RewardBundle`**：描述"得什么"（保底物品 + 摇号掉落 + 货币 + 经验）

## 职责

- **类型定义**（`types.ts`）：`CostDef`、`RewardBundle`、`LootEntry`、`ItemGrant`、`LootDistributionMode`、`RewardSource`
- **开销操作**（`cost.ts`）：`checkCost`、`applyCost`、`refundCost`
- **奖励发放**（`reward.ts`）：`rollDrops`、`grantRewards`、`grantItemToCharacter`
- **多人分配**（`loot.ts`）：`distributeRewards`

## 核心类型

### `CostDef` — 开销

```ts
interface CostDef {
  currencies?: Record<string, number>;  // 货币消耗
  items?: { itemId: ItemId; qty: number }[];  // 仅堆叠材料
}
```

**不在此处**：MP / TP（由各自系统处理），`GearInstance`（由调用方在执行前单独校验和移除）。

### `RewardBundle` — 奖励束

```ts
interface RewardBundle {
  items?: ItemGrant[];      // 保底物品（确定发放，不受爆率影响）
  drops?: LootEntry[];      // 摇号掉落（受爆率影响）
  currencies?: Record<string, number>;
  xp?: { skillId: SkillId; amount: number }[];
  charXp?: number;
}
```

`items` 和 `drops` 的语义区别：`items` 是保底，每次必得；`drops` 是摇号桶，每条按 `chance` 独立摇号，爆率加成只作用于 `drops`。

## 多人分配规则（`distributeRewards`）

| 类型 | 分配方式 | 余数 |
|---|---|---|
| `currencies` / `charXp` / `skillXp` | `floor(总量 / 人数)` 每人一份 | 随机给一人 |
| `items`（保底） | 整批随机给一人 | — |
| `drops`（摇号） | 每人独立摇，`effectiveChance = entry.chance / partySize` | — |

单人时退化为 `grantRewards`（partySize = 1）。

## `grantItemToCharacter` — 可替换接入点

物品发放的统一入口。当前实现：先尝试放入角色个人背包，满则溢出至 Stage 的 `pendingLoot`。

未来改为共享背包时，只替换此函数实现，上层调用方不需改动。

## 爆率加成

`rollDrops(drops, rng, { dropRateMod })` 按 `effectiveChance = min(1.0, entry.chance × dropRateMod)` 计算有效概率。当前超出 1.0 部分 clamp；未来扩展为溢出额外次数时，只改此函数内部。

多人时爆率传入 `dropRateMod = 玩家自身爆率 / partySize`，维持期望总掉落量不变。

## 开销操作

```ts
checkCost(cost, ctx) → boolean       // 检查是否可以承担，不修改状态
applyCost(cost, ctx) → void          // 扣除（不足时 throw）
refundCost(cost, ctx) → void         // 返还（各模块自行决定何时调用）
```

`refundCost` 是框架提供的接口，各模块自己实现返还时机（例如 `CraftingActivity` 被中断时返还材料）。

## `RewardSource` — 日志来源标签

`grantRewards` 接收 `source: { kind, id }` 标签，供 game-log 区分来源：

| kind | 语义 |
|---|---|
| `"kill"` | 击杀怪物 |
| `"wave"` | 战斗区波次通关 |
| `"dungeon_wave"` | 副本单波清关 |
| `"dungeon_completion"` | 副本完成 |
| `"craft"` | 制作 |
| `"gather"` | 采集 |
| `"other"` | 其他 |

## `LootDistributionMode` — 预留扩展点

```ts
type LootDistributionMode = "random_member"; // | "shared_inventory" 未来
```

当前只有 `"random_member"`（道具整批随机给一人）。`CombatZoneDef.lootDistribution` 可指定此模式。未来切换到共享背包时，添加新模式值而不破坏旧逻辑。

## UI 组件

- `src/ui/components/CostDisplay.tsx`：展示开销，标红不可负担的条目
- `src/ui/components/RewardDisplay.tsx`：展示保底物品 + 概率掉落（带%）+ 货币 + 经验

## 边界

- 不负责 MP / TP / GearInstance 的消耗
- 不负责 `pendingLoot` 的手动拾取（由 `inventory` 模块负责）
- 不持有运行时状态；所有操作是纯函数或对 `GameState` 的直接变更
- `refundCost` 只提供接口，不主动调用；各模块自行决定返还时机

## 入口

- `src/core/economy/` — 核心逻辑
- `src/ui/components/CostDisplay.tsx`
- `src/ui/components/RewardDisplay.tsx`

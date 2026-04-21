# item / inventory

物品实例与背包容器。

## 物品类型

系统里有两类物品：

- **Stackable（可堆叠材料）**：`{ itemId, qty }`，相同 `itemId` 会合并到同一格
- **Gear（装备实例）**：`GearInstance { instanceId, itemId, rolledMods }`

## GearInstance

- 所有装备实例都必须通过 `createGearInstance(itemId, { rng })` 创建
- 掉落、合成和开发调试都走同一个入口，避免出现绕过实例化规则的路径
- `ItemDef.modifiers` 是基线属性，`rolledMods` 是单个实例自己的额外属性
- `rebuildCharacterDerived` 会把这两部分 modifier 合并起来
- `sourceId` 会携带 `instanceId`，这样卸装时可以精确撤销对应 modifier

## 背包

- `Inventory { capacity, slots }` 表示固定位置的网格背包；空格是 `null`
- stack 与 gear 可以混放，槽位索引保持稳定
- `state.inventories` 按 `charId` 或 `"shared"` 分包

## 装备

- 装备直接保存在 `PlayerCharacter.equipped: Record<slot, GearInstance | null>` 中
- 物品遵循单一所有权：要么在背包里，要么装备在角色身上

## 边界

- 不负责属性堆叠；modifier 的合并与查询由 `attribute` 模块处理
- 不负责掉落判定；combat 模块只发事件，由 listener 调用工厂并把物品加入背包

## 入口

- `src/core/item/`
- `src/core/inventory/`

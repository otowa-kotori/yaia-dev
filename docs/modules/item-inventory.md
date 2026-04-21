# item / inventory

物品实例与背包容器。

## 物品两类

- **Stackable（材料）**：`{ itemId, qty }`，同 id 合并成一格。
- **Gear（装备）**：`GearInstance { instanceId, itemId, rolledMods }`。

## GearInstance

- 所有 gear 必须经 `createGearInstance(itemId, { rng })` 创生——掉落、合成、dev 路径共用这一口子。
- `ItemDef.modifiers` 是基线，`rolledMods` 是 per-instance 加成，两者在 `rebuildCharacterDerived` 合并。`sourceId` 携带 `instanceId`，便于卸装精准撤销。

## 背包

- `Inventory { capacity, slots }`：固定位置网格，空格为 `null`，stack 与 gear 混放。索引稳定。
- `state.inventories` 按 `charId` 或 `"shared"` 分包。

## 装备

- 直接内联在 `PlayerCharacter.equipped: Record<slot, GearInstance | null>`。单一所有权：要么在背包，要么在身上。

## 边界

- 不做装备属性堆叠（attribute 模块负责）。
- 不做掉落判定（combat 模块发事件，listener 调工厂落袋）。

入口：`src/core/item/`、`src/core/inventory/`。

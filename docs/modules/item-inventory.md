# item / inventory

物品实例、背包容器与装备占用关系。

## 定位

- **item** 负责定义“一个物品副本长什么样”，尤其是不可堆叠装备的实例化规则。
- **inventory** 负责定义“这些物品放在哪里”，也就是固定槽位背包与槽位级增删。
- **actor.equipped** 负责定义“角色当前穿在身上的物品”。

三者共同维护同一条不变量：**同一个物品实例同一时刻只能在一个地方，要么在背包里，要么在装备栏里。**

## 职责

- **物品类型**：
  - `StackEntry` 表示可堆叠材料：`{ itemId, qty }`
  - `GearInstance` 表示装备实例：`{ instanceId, itemId, rolledMods }`
- **实例工厂**：所有装备副本都必须通过 `createGearInstance(itemId, { rng })` 创建。
- **背包容器**：`Inventory { capacity, slots }` 表示固定位置网格背包；空槽位为 `null`。
- **角色装备**：`PlayerCharacter.equipped: Record<slot, GearInstance | null>` 保存当前已装备物品。
- **UI 交互**：`InventoryView` 提供背包浏览、物品详情、装备与卸装的第一层交互。

## 当前交互

- **点击槽位看详情**：点击非空槽位后，在右侧详情面板展示名称、描述、数量、标签、装备槽位与 modifier。
- **从个人背包装备**：
  - 只有 `stackable=false` 且 `ItemDef.slot` 已定义的物品可装备。
  - 当前实现只支持从**角色个人背包**直接装备。
  - 若目标装备槽已有旧装备，则旧装备会回到原槽位，保持槽位索引稳定。
- **从装备面板卸装**：点击装备面板中的“卸下”后，装备实例回到角色个人背包。
- **共享背包**：当前只支持浏览与详情查看；不支持直接从共享背包装备。

## 不变量

- **单一所有权**：装备实例不会同时出现在 `inventory.slots` 与 `hero.equipped`。
- **槽位稳定**：装备时若发生同槽位替换，旧装备回填到原背包槽位，而不是重新找空位。
- **实例级 modifier**：最终生效属性 = `ItemDef.modifiers` + `GearInstance.rolledMods`，由 `rebuildCharacterDerived` 统一重建。
- **材料与装备分流**：可堆叠物品走 `addStack`，不可堆叠装备走 `addGear`。
- **结果返回而非异常**：`addStack` / `addGear` 在背包满时返回 `{ ok: false }` 而不是抛异常——背包满是正常游戏状态。Session 层的合成 / 卸装等操作会检查结果并 throw（这些场景不允许失败）。

## 溢出与待拾取 (Pending Loot)

当 Activity（战斗 / 采集）产生物品奖励时：
- **优先入包**：通过 `addStack` / `addGear` 尝试放入角色背包。
- **溢出进 pending**：背包满时，溢出的物品进入 `StageSession.pendingLoot`。
- **手动拾取**：玩家通过 `pickUpPendingLoot(index)` 或 `pickUpAllPendingLoot()` 从待拾取区取回物品。
- **离开丢失**：离开 Stage 时 `pendingLoot` 随 session 一起清空。UI 层应在 `pendingLoot` 非空时弹出确认。

货币和经验值仍然即时发放，不受背包限制。

## 边界

- **不负责属性结算**：modifier 的合并、查询与 clamp 由 `attribute` 和 `actor` 负责。
- **不负责内容定义**：物品静态数据来自 `ContentDb.items`。
- **不负责合成规则**：配方校验与制作流程由 `session` / `crafting` 负责。
- **不负责高级交互**：当前不包含拖拽、拆分堆叠、丢弃、出售或使用消耗品。

## 入口

- `src/core/item/`
- `src/core/inventory/`
- `src/ui/ItemSlot.tsx`（可复用物品格子组件）
- `src/ui/PendingLootPanel.tsx`（待拾取面板，战斗 tab + 背包 tab 共用）
- `src/ui/InventoryView.tsx`

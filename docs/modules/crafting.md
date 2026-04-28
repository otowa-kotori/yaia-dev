# crafting

配方制作、材料校验与合成界面。

## 定位

`crafting` 模块负责把静态配方变成一次真实的“制作”操作，打通“材料 → 配方 → 产物 → 技能 XP”的链路。

当前它不是独立的 core 子目录，而是由三部分共同构成：

- `ContentDb.recipes`：静态配方定义
- `CharacterController.craftRecipe()`：运行时制作指令
- `CraftPanel`：配方浏览与一键制作 UI

## 职责

- **配方定义**：`RecipeDef` 描述技能门槛、制作开销（`cost: CostDef`）、制作奖励（`rewards: RewardBundle`）与名义制作时长。开销和奖励类型来自 `economy` 模块。
- **制作校验**：检查角色是否空闲、技能等级是否满足、背包材料是否足够（通过 `CostDef.items`）、产物是否放得下。
- **库存变更**：先扣除 `cost.items` 中的材料，再写入 `rewards.items` 中的产物；装备产物仍通过实例工厂创建。
- **成长反馈**：制作成功后发放 `rewards.xp` 中的技能经验，并向 UI 发出 `crafted` / `inventoryChanged` 事件。
- **界面展示**：`CraftPanel` 负责展示配方、需求材料、产物和当前阻塞原因。


## 当前实现

- **制作入口**：UI 默认调用 `session.focused.craftRecipe(recipeId)`；低层调用方仍可先取 `getFocusedCharacter()` 再执行。
- **材料来源**：当前只读取角色**个人背包**，不读取共享背包。

- **产物去向**：制作产物写回角色个人背包。
- **首个配方**：`3 × 铜矿石 + 2 × 史莱姆胶 → 1 × 铜剑`，并奖励 `锻造` XP。
- **制作时机**：当前实现为**同步立即完成**；角色正在战斗或采集时不可制作。
- **时长字段**：`RecipeDef.durationTicks` 已保留，但目前只作为内容字段和 UI 信息展示，尚未驱动独立制作计时。

## 不变量

- **先验可放入检查**：制作前会在背包草稿上模拟扣料和产出，避免先扣材料后发现背包塞不下。
- **装备实例化**：所有非堆叠产物必须走 `createGearInstance`，不能直接伪造 `GearInstance`。
- **失败即不改状态**：任一前置检查失败时，不应产生部分扣料或部分产出。

## 边界

- **不是采集系统**：材料获取由 `gather` / `combat` 奖励路径负责。
- **不是装备系统**：制作成功只负责把装备放进背包，不自动替角色装备。
- **不是排队系统**：当前没有 `CraftingActivity`、批量制作、队列、取消或中断恢复。
- **不是解锁系统**：当前默认显示全部已注册配方，没有发现、熟练度或工作台解锁逻辑。

## 后续扩展点

- **独立 `CraftingActivity`**：把 `durationTicks` 真正接入 tick 驱动的制作过程。
- **批量制作 / 队列**：允许连续制作多个产物。
- **共享仓库与工作台**：让配方可读取共享库存或地点设施。
- **配方解锁**：为配方增加发现条件、掉落图纸或技能门槛之外的限制。

## 入口

- `src/core/content/types.ts`（`RecipeDef`）
- `src/core/session/gameplay/inventory.ts`（`craftRecipe` 实现）
- `src/core/session/index.ts`（公开组装入口）
- `src/ui/panels/CraftPanel.tsx`

- `src/content/index.ts`（默认配方与锻造技能）

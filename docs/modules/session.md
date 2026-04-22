# session

`GameSession` 是运行时编排层，采用 **GameSession + CharacterController** 的两层接口。

## 定位

- **GameSession** 负责全局生命周期、tick 引擎、事件总线、随机数、共享状态与角色管理。
- **CharacterController** 负责单角色的 gameplay 指令，UI 不需要反复传 `charId`。
- **Store** 构建在 `GameSession` 之上，额外补充订阅、revision 和自动存档。

## 职责

- **全局指令**：`setSpeedMultiplier`、`getSpeedMultiplier`、`loadFromSave`、`resetToFresh`、`dispose`
- **角色管理**：`getCharacter(charId)`、`getFocusedCharacter()`、`setFocusedChar(charId)`、`listHeroes()`
- **单角色指令**：
  - `enterLocation(locationId)` / `leaveLocation()`
  - `startFight(combatZoneId)` / `startGather(nodeId)` / `stopActivity()`
  - `equipItem(slotIndex)` / `unequipItem(slot)`
  - `craftRecipe(recipeId)`
- **新档初始化**：`resetToFresh()` 根据 `ContentDb.starting.heroes` 创建角色、背包、起始物品，并让角色进入初始地点。
- **读档恢复**：`loadFromSave()` 重建角色控制器、stage controller 与运行中 activity。

## 装备与合成入口

- **装备**：
  - `equipItem(slotIndex)` 从当前角色的**个人背包槽位**装备一件 gear。
  - 如果目标装备槽已有旧装备，则旧装备回填到原背包槽位。
  - `unequipItem(slot)` 把该槽位装备放回角色个人背包。
- **合成**：
  - `craftRecipe(recipeId)` 只在角色未运行 battle / gather activity 时允许执行。
  - 制作前会同时校验技能等级、材料是否足够以及产物是否能放回背包。
  - 成功后写入产物、发放技能 XP，并发出刷新 UI 所需事件。

## 事件协作

`session` 自己不做 React 刷新；它通过事件总线把状态变化通知给上层：

- `inventoryChanged`：背包内容发生变化
- `equipmentChanged`：装备槽位发生变化
- `crafted`：一次制作成功完成
- `activityComplete`：活动自然结束

`src/ui/store.ts` 监听这些事件后触发订阅通知并安排持久化。

## 边界

- **不负责 UI 状态**：tab、选中项、提示文案、详情面板等都不在 session 层管理。
- **不负责内容定义**：session 只读取 `ContentDb`，不持有设计数据源。
- **不直接写存档介质**：session 只维护内存状态；何时持久化由 store 决定。
- **不绕过规则层**：装备、合成、采集、战斗都尽量复用现有 core 模块能力，而不是在 session 里重写一套规则。

## 不变量

- **角色作用域清晰**：`CharacterController` 的命令只作用于自己绑定的 hero。
- **同一角色单活动**：每个角色同一时刻最多只有一个运行中的 activity。
- **Stage 独立管理**：stage controller 放在 session 层的 `Map<stageId, StageController>` 中，而不是挂在角色身上。
- **运行时 ID 单一来源**：stage / battle / dungeon session / spawned actor 的实例 ID 全都从 `GameState.runtimeIds.nextSeq` 继续发号；`loadFromSave` / `resetToFresh` 不再重建各自模块的本地计数器。
- **恢复不重复副作用**：从存档恢复 activity 时，不重复触发只应在首次启动时执行的 `onStart` 副作用。

## 入口

- `src/core/session/index.ts`
- `src/ui/store.ts`

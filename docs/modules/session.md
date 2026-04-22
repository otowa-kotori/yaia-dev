# session

`GameSession` 是运行时编排层，采用两层接口设计。

## 两层接口

- **GameSession**（全局层）：tick 引擎、事件总线、rng、state、角色管理（`getCharacter`、`getFocusedCharacter`、`listHeroes`）、全局指令（速度、存档、重置）
- **CharacterController**（单角色层）：per-hero 运行时句柄，暴露 `enterLocation`、`startFight`、`startGather`、`stopActivity`、`equipItem`、`craftRecipe` 等命令——不需要传 charId

UI 通过 `session.getFocusedCharacter()` 获取当前聚焦角色的 controller，直接调方法。

## 定位

- Store 构建在 `GameSession` 之上，并额外补充订阅与存档能力
- UI、测试和脚本进入游戏世界时，统一通过 `createGameSession` 或基于它构建出的 store
- `GameSession` 是各个 core 模块的运行时聚合点，但不是规则例外层

## 职责

- **全局指令**：`setSpeedMultiplier`、`loadFromSave`、`resetToFresh`、`dispose`
- **角色管理**：`getCharacter(charId)`、`getFocusedCharacter()`、`setFocusedChar(charId)`、`listHeroes()`
- **CharacterController 指令**：`enterLocation`、`leaveLocation`、`startFight`、`startGather`、`stopActivity`、`equipItem`、`unequipItem`、`craftRecipe`
- **生命周期**：`loadFromSave` 负责接管存档恢复并重建所有 controller；`resetToFresh` 根据 `ContentDb.starting.heroes` 初始化多角色新游戏；`dispose` 负责停止引擎

## 边界

- 不负责 UI 状态，例如 revision、订阅和存档节流都由 store 处理
- 不持有内容定义，只读取 `ContentDb`
- 不为跨模块规则单独开例外；只负责把已有模块组合起来

## 不变量

- 每个角色同一时刻最多只有一个 stage（通过 `hero.stageId` 引用 `state.stages` 中的条目）
- 每个角色同一时刻最多只有一个 activity（持有在 CharacterController 内部）
- Stage 独立于角色：多个角色可以引用同一个 stageId（未来多人副本预留）
- StageController 由 session 层独立管理（`stageControllers Map`），不归属 CharacterController
- Stage 销毁时检查是否还有角色引用该 stageId，无引用才真正清理
- 从存档恢复 activity 时，按继续执行处理，不重复触发仅应在首次启动时发生的 `onStart` 副作用

## 入口

`src/core/session/index.ts`

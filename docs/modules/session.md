# session

`GameSession` 是运行时编排层。它聚合 tick 引擎、事件总线、随机数、`GameState`、stage controller 与当前 activity，并对外暴露游戏指令。

## 定位

- Store 构建在 `GameSession` 之上，并额外补充订阅与存档能力
- UI、测试和脚本进入游戏世界时，统一通过 `createGameSession` 或基于它构建出的 store
- `GameSession` 是各个 core 模块的运行时聚合点，但不是规则例外层

## 职责

- **指令**：`enterStage`、`leaveStage`、`startFight`、`startGather`、`stopActivity`
- **生命周期**：`loadFromSave` 负责接管存档恢复；`resetToFresh` 根据 `ContentDb.starting` 初始化新游戏；`dispose` 负责停止引擎
- **查询**：提供 `getHero`、`isRunning`、`getSpeedMultiplier` 等适合 UI 调用的只读入口

## 边界

- 不负责 UI 状态，例如 revision、订阅和存档节流都由 store 处理
- 不持有内容定义，只读取 `ContentDb`
- 不为跨模块规则单独开例外；只负责把已有模块组合起来

## 不变量

- 同一时刻最多只有一个 `currentStage`
- 同一时刻最多只有一个当前 activity
- 从存档恢复 activity 时，按继续执行处理，不重复触发仅应在首次启动时发生的 `onStart` 副作用

## 入口

`src/core/session/index.ts`

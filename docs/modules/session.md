# session

GameSession 是运行时编排层，聚合 tick 引擎、事件总线、rng、GameState、stage controller 和当前 activity，对外暴露游戏指令。

## 定位

- Store 的底座：store 通过 `Object.assign` 把订阅与存档方法混入 session，`GameStore extends GameSession`。
- Core 各模块的唯一聚合点：UI / 测试 / 脚本进入游戏世界的入口都是 `createGameSession`。

## 职责

- **指令**：`enterStage` / `leaveStage` / `startFight` / `startGather` / `stopActivity`。
- **生命周期**：`loadFromSave` 接管存档恢复；`resetToFresh` 按 `ContentDb.starting` 构造新游戏；`dispose` 停引擎。
- **查询**：`getHero` / `isRunning` / `getSpeedMultiplier` 等 UI 友好的只读入口。

## 边界

- 不承担 UI 状态（revision、订阅、存档节流由 store 负责）。
- 不持有内容定义，只读 `ContentDb`。
- 不做跨模块规则的例外处理，只做组合。

## 不变量

- 同一时刻至多一个 `currentStage` 与一个 activity。
- `rehydrate` 走 resume 路径，不触发 `onStart` 副作用。

入口：`src/core/session/index.ts`。

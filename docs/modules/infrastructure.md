# tick / rng / events / formula / state

这些模块是 Core 的底层基础设施，不依赖其他 core 模块。

## tick

- 逻辑时钟固定为 10 Hz
- `TickEngine` 按注册顺序调度 `Tickable`
- 所有周期性行为都以 `Tickable` 的形式挂到引擎上，例如 activity、stage controller、UI notifier
- 速度倍率由引擎统一缩放，因此 headless 与实时模式的行为保持等价

### catch-up（离线/后台追帧）

- 入口：`src/core/tick/catch-up.ts`
- `computeCatchUpTicks` 是纯函数，接收 wall clock 差值、logic tick 差值和 TICK_MS，返回需补跑的 tick 数
- 追帧公式：`missingTicks = expectedTicks - actuallyAdvanced`，避免与后台期间浏览器节流推进的 tick 双算
- 追帧永远按 1x 速度计算，不受 UI 倍率影响
- wall clock 上限 24 小时（86,400,000 ms），tick 上限 864,000
- 热恢复（`visibilitychange`）和冷恢复（读档）共用同一套 catch-up 管线
- 追帧完成后发出 `catchUpApplied` 事件

## rng

- 使用可序列化 seed 的确定性 PRNG
- `ctx.rng` 是 gameplay 随机的唯一来源
- 每个 session 都持有自己的 rng 实例；存档时保存其进度，读档时恢复

## events

- 这是一个 typed event bus；事件名和 payload 结构都集中定义在 `src/core/infra/events/index.ts`
- 常见事件包括 `damage`、`kill`、`levelup`、`loot`、`activityComplete`
- 玩家可见日志相关事件也走同一总线，例如 `locationEntered`、`activityStarted`、`currencyChanged`、`battleActionResolved`
- 它用于跨模块解耦：例如战斗模块发事件，奖励、日志收集器、UI、存档逻辑各自监听

## game-log

- `src/core/infra/game-log/` 负责把 typed event 转成玩家可读中文日志
- `rules.ts` 集中维护“事件 → 文案”的配置化规则表
- `collector.ts` 监听事件总线，把日志写入 `GameState.gameLog`，并通过 `gameLogAppended` 通知 UI / Store
- 日志只保存最小纯数据：`tick`、`category`、`text`、`scope`，避免把原始 payload 和运行时对象塞进存档

## formula

- 使用“命名公式 + 参数”的形式，例如 `{ kind: "exp_curve_v1", base, growth }`
- `evalFormula` 通过 `switch` 分派到具体实现
- XP 曲线、升级成本、伤害系数等数值曲线都走同一个入口，便于调参与复用

## state

- `GameState` 是根状态容器，且必须保持为可序列化的纯数据
- 它聚合 `actors`、`inventories`、`currencies`、`battles`、`stages`、`worldRecord`、`gameLog` 等子状态
- 所有进入存档的字段都必须能进行 JSON 往返
- 派生字段应只存在于内存中，不直接写入序列化结果

## 入口

`src/core/{tick,rng,events,formula,state}/`

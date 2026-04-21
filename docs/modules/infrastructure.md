# tick / rng / events / formula / state

这些模块是 Core 的底层基础设施，不依赖其他 core 模块。

## tick

- 逻辑时钟固定为 10 Hz
- `TickEngine` 按注册顺序调度 `Tickable`
- 所有周期性行为都以 `Tickable` 的形式挂到引擎上，例如 activity、stage controller、UI notifier
- 速度倍率由引擎统一缩放，因此 headless 与实时模式的行为保持等价

## rng

- 使用可序列化 seed 的确定性 PRNG
- `ctx.rng` 是 gameplay 随机的唯一来源
- 每个 session 都持有自己的 rng 实例；存档时保存其进度，读档时恢复

## events

- 这是一个不依赖具体类型定义的事件总线
- 常见事件包括 `damage`、`kill`、`levelup`、`loot`、`activityComplete`
- 它用于跨模块解耦：例如战斗模块发事件，奖励、UI、存档逻辑各自监听

## formula

- 使用“命名公式 + 参数”的形式，例如 `{ kind: "exp_curve_v1", base, growth }`
- `evalFormula` 通过 `switch` 分派到具体实现
- XP 曲线、升级成本、伤害系数等数值曲线都走同一个入口，便于调参与复用

## state

- `GameState` 是根状态容器，且必须保持为可序列化的纯数据
- 它聚合 `actors`、`inventories`、`currencies`、`battles`、`currentStage`、`worldRecord` 等子状态
- 所有进入存档的字段都必须能进行 JSON 往返
- 派生字段应只存在于内存中，不直接写入序列化结果

## 入口

`src/core/{tick,rng,events,formula,state}/`

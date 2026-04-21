# tick / rng / events / formula / state

Core 的底层基础设施，不依赖任何其他 core 模块。

## tick

- 10 Hz 逻辑时钟。`TickEngine` 按注册顺序调度 `Tickable`。
- 所有周期性行为（activity、stage controller、UI notifier）都以 Tickable 形态挂入引擎。
- 速度倍率由引擎统一缩放，headless 与实时等价。

## rng

- 确定性 PRNG（seed 可序列化）。`ctx.rng` 是 gameplay 随机的唯一来源。
- 每个 session 持有独立实例，存档时保存进度，读档恢复。

## events

- 无类型依赖的事件总线，常用事件：`damage` / `kill` / `levelup` / `loot` / `activityComplete`。
- 作为跨模块解耦通道：战斗模块发事件，奖励/UI/存档监听。

## formula

- 命名公式 + 参数：`{ kind: "exp_curve_v1", base, growth }`。`evalFormula` 以 switch 分派。
- XP 曲线、升级成本、伤害系数等数值曲线共用同一入口，便于内容调参。

## state

- `GameState`：根状态容器，plain data。聚合 `actors` / `inventories` / `currencies` / `battles` / `currentStage` / `worldRecord` 等子槽。
- 必须 JSON 可往返；派生字段另开内存字段，不进入序列化。

入口：`src/core/{tick,rng,events,formula,state}/`。

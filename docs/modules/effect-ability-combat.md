# effect / ability / intent / combat

行为层：GAS 风的数值管线与战斗调度。

## Ability

- 校验 cost / cooldown / target，成功后按顺序对每个目标 apply 其 `effects`。
- 非战斗 ability（如采集挥击）也走同一管线，`targetKind: "none"`。

## Effect

三种 kind，共享同一结算路径：

- **instant**：立即结算，可带 `formula` 与 `rewards`。
- **duration**：安装 modifier + `ActiveEffect`，到期撤销。
- **periodic**：duration 基础上每 `periodTicks` 触发一次 instant 分支。

造成伤害、回血、给 XP / 物品 / 货币、挂 buff——统一走 effect 管线。

## Intent

- `intents: Record<actorId, intentId>` 是字符串；`resolveIntent(id)` 到注册表里查函数。
- 数据驱动 intent 接口已预留，MVP 用代码注册。

## Combat

- `Battle` 是 plain data，住 `state.battles[]`。
- `SchedulerState` 是数据，`nextActor()` 是自由函数。SpeedSortedScheduler 每次 pick 按 speed 重排，buff 即时生效。
- 节奏由 `actionDelayTicks` 推进，headless 与实时一致。
- 胜负由 `tickBattle` 判定；`kill` 事件广播由 listener（如 `CombatActivity`）走 `applyEffect(synthesizedInstantEffect)` 发放奖励，复用同一条 effect 管线。

## 边界

- effect / ability 不知道战斗存在，可用于战斗外（采集、升级）。
- combat 不管奖励落地，只发事件。

入口：`src/core/{effect,ability,intent,combat}/`。

# effect / ability

这一组模块负责通用的行为表达与效果结算，不依赖战斗系统存在。

## 定位

- `Ability` 表示一次可执行行为
- `Effect` 表示行为命中后产生的具体结算

两者组合起来，构成一条可复用的行为管线。采集、升级奖励、战斗技能都可以走这套机制。

## Ability

`Ability` 表示一次可执行行为。

- 执行前会校验 `cost`、`cooldown` 和 `target`
- 校验通过后，会按顺序对每个目标应用它的 `effects`
- 非战斗行为也可以复用同一条管线，例如采集挥击可以使用 `targetKind: "none"`

## Effect

`Effect` 负责具体结算。目前有三种 `kind`，但都走同一条结算路径：

- **instant**：立即结算，可带 `formula` 和 `rewards`
- **duration**：安装 modifier，并登记 `ActiveEffect`；到期后撤销
- **periodic**：以 `duration` 为基础，每隔 `periodTicks` 再触发一次 instant 结算

伤害、治疗、XP、物品、货币、buff 都通过 effect 管线处理，而不是各走一套单独逻辑。

## 边界

- 这一层不依赖 `combat`，因此也能用于采集、升级等战斗外场景
- 它负责表达行为与效果，不负责推进回合、选择行动或判定战斗胜负

## 入口

- `src/core/effect/`
- `src/core/ability/`

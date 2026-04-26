# effect / ability

这一组模块负责通用的行为表达与效果结算，不依赖战斗系统存在。

## 定位

- `Ability` 表示一次可执行行为
- `Effect` 表示行为命中后产生的具体结算

两者组合起来，构成一条可复用的行为管线。采集、升级奖励、战斗技能都可以走这套机制。

## Ability

- 执行前会校验 `cost`、`cooldown` 和 `target`
- 校验通过后，会按顺序对每个目标应用它的 `effects`
- 非战斗行为也可以复用同一条管线，例如采集挥击可以使用 `targetKind: "none"`

## Effect

`Effect` 负责具体结算。目前有三种 `kind`：

- **instant**：立即结算，可带 `formula` 和 `rewards`
- **duration**：安装 modifier，并登记 `ActiveEffect`；到期后撤销
- **periodic**：以 `duration` 为基础，每隔 `periodTicks` 再触发一次 instant 结算

伤害、治疗、XP、物品、货币、buff 都通过 effect 管线处理，而不是各走一套单独逻辑。
同时 effect 会补发结构化结果事件，例如 `heal`、`loot`、`currencyChanged`、`pendingLootOverflowed`，供统一玩家日志与 UI 复用。

## 伤害公式

伤害类型由 `EffectDef.formula.kind` 决定，与施法者职业无关：

### phys_damage_v1（物理伤害）

`return-to-line` 方案：

```
有效攻击 = PATK × skillMul
x = 有效攻击 / PDEF

y = t × x^a                       , x <= 1
y = (x - 1) + t / (1 + m(x - 1)) , x > 1

a = (1 - t × m) / t
最终伤害 = ⌊PDEF × y⌋
```

默认参数：`t=0.25`、`m=1.0`、`skillMul=1.0`。

当 `PDEF <= 0` 时视为无甲，直接返回 `⌊有效攻击⌋`。每段技能独立代入伤害公式，因此多段技能打高甲目标天然削弱；同时不设全局百分比保底，极高甲目标允许被打成 0。


### magic_damage_v1（魔法伤害）

```
最终伤害 = ⌊MATK × skillMul × (1 − MRES)⌋
```

MRES 百分比减伤，上限 0.8，天然无零伤害问题。

## 公式上下文变量

`buildFormulaContext` 注入以下变量供公式使用：

| 变量 | 含义 |
|------|------|
| `patk` / `pdef` | 施法者 PATK / 目标 PDEF |
| `matk` / `mres` | 施法者 MATK / 目标 MRES |
| `source_str/dex/int` | 施法者一级属性（供非伤害公式使用） |
| `source_max_hp` / `source_current_hp` | 施法者 HP |
| `target_max_hp` / `target_current_hp` | 目标 HP |

## 升级触发 rebuild

`grantCharacterXp` 升级时修改 `attrs.base`（应用 HeroConfig.growth 增量），但不主动刷缓存。effect 层检测到升级发生后调用 `rebuildCharacterDerived`，确保派生属性同步更新。

## 边界

- 这一层不依赖 `combat`，因此也能用于采集、升级等战斗外场景
- 它负责表达行为与效果，并桥接稳定的“结果事件”；但不负责推进回合、选择行动或判定战斗胜负
- 货币变动的语义来源（如击杀奖励、波次奖励、副本奖励）由外层调用方通过 `EffectContext` 传入，effect 不自行猜测业务来源

## 入口

- `src/core/behavior/effect/`
- `src/core/behavior/ability/`

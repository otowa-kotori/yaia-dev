# progression / worldrecord / upgrade-manager

跨生命周期的进度轴。

## progression

- 负责 PlayerCharacter 的 level / xp 推进：XP 曲线求值、升级事件广播。
- XP 来源走 effect `rewards` 管线统一派发。

## worldrecord

- `GameState.worldRecord`：跨角色、跨存档周期的全局进度（已购升级等级、统计等）。
- 对属性的影响通过 `computeWorldModifiers` 注入，`sourceId = "world.<upgradeId>"`，卸载/重置可精准清除。

## upgrade-manager

- 纯状态事务：`purchaseUpgrade` 做 `unknown / already_maxed / insufficient_funds / ok` 的门槛判定与扣费，外加 `getUpgradeCost` / `canAffordUpgrade` / `isUpgradeMaxed` 查询。
- 不触发通知、不落盘；store 包一层负责 notify + persist。
- 成本曲线走 `formula` 的 `exp_curve_v1`，modifier 堆叠走 `attribute`。

## 边界

- 不直接操作 UI 层；所有副作用通过 `GameState` 与事件。
- 不处理 currency 定义——currency 仅为字符串 ID，值存 `state.currencies`。

入口：`src/core/{progression,worldrecord,upgrade-manager}/`。

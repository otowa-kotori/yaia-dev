# progression / worldrecord / upgrade-manager

这一组模块负责跨时间维度的进度推进，包括角色成长、全局进度和升级购买。

## progression

- 负责 `PlayerCharacter` 的 level / xp 推进
- 包括 XP 曲线求值与升级事件广播
- XP 来源统一走 effect 的 `rewards` 管线派发

## worldrecord

- `GameState.worldRecord` 用来记录不绑定单个角色的全局进度，例如已购升级等级与统计信息
- 这些全局进度对属性的影响通过 `computeWorldModifiers` 注入
- 注入时使用 `sourceId = "world.<upgradeId>"`，因此卸载或重置时可以精确清除

## upgrade-manager

- 这是一个纯状态事务模块
- `purchaseUpgrade` 负责门槛判定与扣费，并返回 `unknown`、`already_maxed`、`insufficient_funds` 或 `ok`
- 同时提供 `getUpgradeCost`、`canAffordUpgrade`、`isUpgradeMaxed` 等查询函数
- 它不负责通知和落盘；这些副作用由 store 在外层包装
- 成本曲线走 `formula` 的 `exp_curve_v1`
- modifier 堆叠规则走 `attribute`

## 边界

- 不直接操作 UI 层
- 所有可观察结果都通过 `GameState` 变化与事件体现
- 不负责 currency 的内容定义；currency 只作为字符串 ID 使用，数值保存在 `state.currencies`

## 入口

`src/core/{progression,worldrecord,upgrade-manager}/`

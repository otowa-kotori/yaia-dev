# progression / worldrecord / upgrade-manager

这一组模块负责跨时间维度的进度推进，包括角色成长、全局进度和升级购买。

## progression

负责 `PlayerCharacter` 的 level / xp 推进，以及技能经验推进。

### 角色升级与属性成长

`grantCharacterXp` 每次升级时：

1. 从 `ContentDb.starting.heroes.find(h => h.id === pc.heroConfigId)` 查取 `HeroConfig.growth`
2. 将 growth 中每个属性的增量直接累加到 `pc.attrs.base`
3. 广播 `levelup` 事件，**不主动刷缓存**
4. 调用方（effect 层）在升级后统一调 `rebuildCharacterDerived` 刷新派生属性

growth 配置示例（骑士）：
```ts
growth: {
  [ATTR.MAX_HP]: 20,
  [ATTR.STR]: 2.5,   // 小数合法，integer: true 属性在 getAttr 时 floor
  [ATTR.DEX]: 1,
}
```

Speed 不成长——各职业速度在 `HeroConfig.baseAttrs` 里一次性设定，装备可以临时加成。

### XP 曲线

角色与技能可使用不同的 `xpCurve.kind`，当前默认分别走 `char_xp_curve_v1` 与 `skill_xp_curve_v1`。XP 来源统一走 effect 的 `rewards` 管线派发。

## worldrecord

- `GameState.worldRecord` 记录全局进度，例如已购升级等级
- 全局进度对属性的影响通过 `computeWorldModifiers` 注入，`sourceId = "world.<upgradeId>"`
- 卸载或重置时可按 sourceId 精确清除

## upgrade-manager

纯状态事务模块：

- `purchaseUpgrade` 负责门槛判定与扣费，返回 `unknown`、`already_maxed`、`insufficient_funds` 或 `ok`
- 提供 `getUpgradeCost`、`canAffordUpgrade`、`isUpgradeMaxed` 查询函数
- 不负责通知和落盘；这些副作用由 store 在外层包装
- 成本曲线走 `formula` 的 `exp_curve_v1`，modifier 堆叠走 `attribute`

## 边界

- 不直接操作 UI 层
- 所有可观察结果都通过 `GameState` 变化与事件体现
- 不负责 currency 的内容定义；currency 只作为字符串 ID 使用，数值保存在 `state.currencies`

## 入口

`src/core/growth/{leveling,worldrecord,upgrade-manager}/`

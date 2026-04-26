# progression / talent / worldrecord / upgrade-manager

这一组模块负责跨时间维度的进度推进，包括角色成长、天赋点分配、全局进度和升级购买。

## leveling

负责 `PlayerCharacter` 的 level / xp 推进。

### 角色升级与属性成长

`grantCharacterXp` 每次升级时：

1. 从 `ContentDb.starting.heroes.find(h => h.id === pc.heroConfigId)` 查取 `HeroConfig.growth`
2. 将 `growth` 中每个属性的增量直接累加到 `pc.attrs.base`
3. 广播 `levelup` 事件，**不主动刷缓存**
4. 调用方在升级后统一调 `rebuildCharacterDerived`，刷新派生属性

growth 配置示例（骑士）：

```ts
growth: {
  [ATTR.MAX_HP]: 20,
  [ATTR.STR]: 2.5,
  [ATTR.DEX]: 1,
}
```

小数成长是合法的；对 `integer: true` 的属性，最终值在 `getAttr()` 时使用 `Math.round` 取整。

### XP 曲线

角色与技能可使用不同的 `xpCurve.kind`。当前默认角色走 `char_xp_curve_v1`。XP 来源统一走 effect 的 `rewards` 管线派发。

### 速度成长

`SPEED` 不是从 `DEX` 自动导出的。当前实现里：

- 角色基础速度来自 `HeroConfig.baseAttrs`
- 装备与 effect 可以临时加成
- 升级成长默认不直接给 `SPEED`

## talent

负责 talent 点预算、学习、装备与 sustain 切换。

### TP 预算（当前实现）

当前代码里的 TP 预算是：

```text
totalTp = (level - 1) * 3
```

也就是说：

- `computeTotalTp(level)` 负责总 TP
- `computeSpentTp(talentLevels, talentDefs)` 负责统计已花费 TP
- `computeAvailableTp(...) = total - spent`

> 这是**当前实现**；如果未来设计改成“每级 +1，额外来源另算”，应同步修改这里和 `docs/design/jobs.md`。

### 分配规则

`allocateTalentPoint(pc, talentId, content)` 会依次检查：

1. talent 是否存在
2. 该职业是否允许学习（`HeroConfig.availableTalents`）
3. 是否已到达 `maxLevel`
4. TP 是否足够
5. 前置是否满足（`prereqs`）

成功后：

- 提升 `pc.talentLevels[talentId]`
- 如果是第一次学会 active talent，会把它加入 `knownTalents`，并同步到运行时 `knownTalentIds`
- 如果是第一次学会 active / sustain talent，且有空槽，会自动装进 `equippedTalents`
- 如果是 passive / sustain，会调用 `grantEffects()` 安装长期 effect

### passive / sustain 安装

- passive / sustain 安装出来的 effect 实例使用 `remainingActions = -1`
- 升级同一 talent 时，会先移除旧的 `sourceTalentId` effect，再装新等级版本
- sustain 通过 `activeSustains[group]` 记录互斥组当前激活项

### 装备与切换

- `equipTalent()` / `unequipTalent()` 只作用于 active / sustain talent
- passive talent 不能装备
- 基础攻击不占槽位
- sustain 若被卸下，会同步移除其长期 effect
- `toggleSustain()` 负责显式切换 sustain 的开关状态

## worldrecord

- `GameState.worldRecord` 记录全局进度，例如已购升级等级
- 全局进度对属性的影响通过 `computeWorldModifiers()` 注入，`sourceId = "world.<upgradeId>"`
- 卸载或重置时可按 `sourceId` 精确清除

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

`src/core/growth/{leveling,talent,worldrecord,upgrade-manager}/`

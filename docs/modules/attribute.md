# attribute

数值层：定义 `ATTR` 常量、modifier 的堆叠规则，以及派生属性缓存。

## 堆叠模型

```text
final = (base + Σflat) × (1 + Σpct_add) × Π(1 + pct_mult) → clamp → integer
```

含义如下：

- `flat`：固定值加成
- `pct_add`：默认使用的百分比加成，先求和再参与计算
- `pct_mult`：预留给少数特殊场景的乘法联动，例如稀有套装效果

## modifier 来源

- `sourceId` 用来标记 modifier 的来源，例如装备 `instanceId`、effect、upgrade
- 撤销 modifier 时按 `sourceId` 精确清除，避免误删同类来源

## 派生字段

- `attrs.modifiers` 与 `attrs.cache` 都是派生数据，不直接进入存档
- 读档时由 `rebuildCharacterDerived` 重建
- 缓存按 stat 粒度懒失效：某个 stat 变化时，只作废该 stat 的缓存

## 边界

- 不负责决定 modifier 从哪里来；equip、effect、upgrade 等模块只负责提供 modifier
- 只负责堆叠与查询，不负责时间流逝；effect 的生命周期由 `effect` 模块管理

## 入口

`src/core/attribute/`

# attribute

数值层：ATTR 常量、Modifier 堆叠规则、派生属性缓存。

## 堆叠模型

```
final = (base + Σflat) × (1 + Σpct_add) × Π(1 + pct_mult) → clamp → integer
```

- `pct_add` 为默认百分比加成，`pct_mult` 预留给稀有套装的乘法联动。
- `sourceId` 标注来源（装备 instanceId、effect、upgrade 等），撤销按 sourceId 精准清除。

## 派生字段

- `attrs.modifiers` 与 `attrs.cache` 是派生数据，存档剥离、读档由 `rebuildCharacterDerived` 重建。
- 按 stat 粒度懒失效：单一 stat 变更只作废对应缓存。

## 边界

- 不持有属性来源的具体业务（equip / effect / upgrade 由各自模块提供 modifier）。
- 只负责堆叠与查询，不做时间流逝（effect 生命周期由 `effect` 模块管）。

入口：`src/core/attribute/`。

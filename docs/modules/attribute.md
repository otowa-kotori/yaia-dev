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

## 响应式属性

### 派生 base（AttrDef.computeBase）

`AttrDef` 可以携带一个 `computeBase(get)` 函数，用于取代 `set.base[id]` 作为该属性的 base 值。函数内部通过 `get(attrId)` 读取其他属性的最终值，从而实现派生关系，例如：

```
PATK = WEAPON_ATK × (1 + 0.3 × √STR)
```

`dependsOn` 字段声明 `computeBase` 读取了哪些属性，用于构建 invalidation 依赖图。

### 动态 modifier provider（DynamicModifierProvider）

`DynamicModifierProvider` 在 `recomputeStat` 时临时计算 modifier 值，而不是在安装时写死。典型用途是"基于 INT 提升治疗量"：INT 因 buff 变化后，依赖 INT 的 modifier 自动随之更新。

- `compute(get)` 在每次 recompute 时调用
- `targetAttrs` 声明可能输出的属性（用于 invalidation）
- `dependsOn` 声明读取了哪些属性（用于构建 depGraph）

管理 API：`addDynamicProvider` / `removeDynamicProvider` / `rebuildDepGraph`

## invalidation 传播

`AttrSet.depGraph` 记录反向依赖图（`stat → 依赖它的 stat 集合`），由 `AttrDef.dependsOn` 和 `DynamicModifierProvider.dependsOn` 汇总生成。

当某个 stat 的 cache 被清除时，`invalidateStat` 沿 depGraph 递归向下传播，把所有依赖它的 stat 也标脏。下次 `getAttr` 时再 lazy recompute，无需显式刷新调用。

循环依赖会在 `recomputeStat` 入口立刻 throw——内容设计有错时尽早暴露。

## 派生字段

以下字段是运行时派生数据，不直接进入存档，读档时由 `rebuildCharacterDerived` 重建：

- `attrs.modifiers`：从装备、activeEffects、世界升级重新安装
- `attrs.dynamicProviders`：从 activeEffects / 天赋重新安装（基础设施已就绪，内容侧后续接入）
- `attrs.depGraph`：从 attrDefs + dynamicProviders 重新构建
- `attrs.cache`：全部标脏，lazy recompute

## 边界

- 不负责决定 modifier 从哪里来；equip、effect、upgrade 等模块只负责提供 modifier
- 只负责堆叠与查询，不负责时间流逝；effect 的生命周期由 `effect` 模块管理
- 循环依赖是内容设计错误，属性层直接 throw，不兜底

## 入口

`src/core/entity/attribute/`

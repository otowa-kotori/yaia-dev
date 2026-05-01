# attribute

数值层：定义 `ATTR` 常量、modifier 的堆叠规则，以及派生属性缓存。

## 属性分层

```text
一级属性       STR / DEX / INT
聚合层         PHYS_POTENCY / MAG_POTENCY   ← DynamicModifierProvider 汇聚一级属性
面板层         PATK / MATK                  ← computeBase 派生（依赖武器值 + 聚合层）
武器层         WEAPON_ATK / WEAPON_MATK     ← 装备 flat 叠加；赤手 defaultBase 4 / 0
防御层         PDEF / MRES                  ← PDEF 装备 flat；MRES 百分比，上限 0.8
其他           MAX_HP / MAX_MP / SPEED / CRIT_RATE / CRIT_MULT
```

已退役：`ATK`、`DEF`、`WIS`（分别由 PATK/MATK、PDEF/MRES、INT 取代）。

## 面板攻击力公式

```
PATK = floor(WEAPON_ATK × (1 + 0.03 × PHYS_POTENCY))
MATK = floor(WEAPON_MATK × (1 + 0.03 × MAG_POTENCY))
```

`k = 0.03`，线性缩放。`computeBase` 由 AttrDef 配置，依赖链由 `dependsOn` 声明。

## 堆叠模型

```text
final = (base + Σflat) × (1 + Σpct_add) × Π(1 + pct_mult) → clamp → integer
```

- `flat`：固定值加成
- `pct_add`：默认使用的百分比加成，先求和再参与计算
- `pct_mult`：预留给少数特殊场景的乘法联动，例如稀有套装效果

## modifier 来源

- `sourceId` 用来标记 modifier 的来源，例如装备 `instanceId`、effect、upgrade
- 撤销 modifier 时按 `sourceId` 精确清除，避免误删同类来源

## 响应式属性

### 派生 base（AttrDef.computeBase）

`AttrDef` 可携带 `computeBase(get)` 函数，取代 `set.base[id]` 作为 base 值。函数内通过 `get(attrId)` 读取其他属性的最终值，实现派生关系。`dependsOn` 声明依赖，用于构建 invalidation 依赖图。

### 动态 modifier provider（DynamicModifierProvider）

在 `recomputeStat` 时临时计算 modifier 值。典型用途：physScaling / magScaling（一级属性 → 聚合层），以及"基于 INT 提升治疗量"类天赋。

- `compute(get)` 在每次 recompute 时调用
- `targetAttrs` 声明可能输出的属性（用于 invalidation）
- `dependsOn` 声明读取了哪些属性（用于构建 depGraph）

管理 API：`addDynamicProvider` / `removeDynamicProvider` / `rebuildDepGraph`

## invalidation 传播

`AttrSet.depGraph` 记录反向依赖图（`stat → 依赖它的 stat 集合`），由 `AttrDef.dependsOn` 和 `DynamicModifierProvider.dependsOn` 汇总生成。当某个 stat 的 cache 被清除时，`invalidateStat` 沿 depGraph 递归传播，把所有依赖它的 stat 也标脏。下次 `getAttr` 时 lazy recompute。

循环依赖在 `recomputeStat` 入口立刻 throw——内容设计有错时尽早暴露。

## 派生字段

以下字段不进存档，读档时由 `rebuildCharacterDerived` 重建：

- `attrs.modifiers`：从装备、activeEffects、世界升级重新安装
- `attrs.dynamicProviders`：physScaling / magScaling providers 以及 effect/天赋 providers
- `attrs.depGraph`：从 attrDefs + dynamicProviders 重新构建
- `attrs.cache`：全部标脏，lazy recompute

## 边界

- 不负责决定 modifier 从哪里来；equip、effect、upgrade 等模块只负责提供 modifier
- 只负责堆叠与查询，不负责时间流逝；effect 的生命周期由 `effect` 模块管理
- 循环依赖是内容设计错误，属性层直接 throw，不兜底

## 入口

`src/core/entity/attribute/`

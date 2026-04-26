# 响应式属性：派生 base 与动态 modifier

> 依赖：[combat-formula.md](./combat-formula.md), [skill-system.md](./skill-system.md)
> 
> **状态**：已实现（`src/core/entity/attribute/index.ts`，`src/content/default/attributes.ts`）

---

## 1. 要解决的问题

当前属性系统不只是静态 modifier 堆叠，还需要支持两类“值会跟别的属性联动变化”的场景。

### 1.1 派生 base

例如当前默认内容里：

- 一级属性先汇聚成 `PHYS_POTENCY / MAG_POTENCY`
- `PATK / MATK` 再通过 `computeBase` 从武器值与潜力值派生

这意味着 `PATK` 的 base 不是一个写死的数字；它会随着 `STR / DEX / INT`、装备、buff 一起变化。

### 1.2 动态 modifier

例如某个被动效果写成“基于 INT 提升治疗量”。

如果之后 `INT` 因为战斗中的 buff 变化，这条 modifier 的 value 也必须自动失效并重算，而不是等到某个“检查点刷新”。

### 1.3 为什么不能靠检查点批量刷新

直觉方案是“装备切换 / 天赋升级后遍历刷新”。问题在于：

- 战斗中 buff 导致的属性变化不会经过这些检查点
- 一个 +INT buff 安装后，依赖 INT 的 modifier 会一直是旧值

真正的触发条件应该是：**属性值本身变了**，而不是某个宽泛操作发生了。

---

## 2. 核心思路：统一 lazy invalidation

当前属性系统已经是 lazy 的——`getAttr()` 发现 cache miss 才 `recomputeStat()`。新需求正好融入这条路径：

1. **派生 base**：`recomputeStat()` 时不直接读 `set.base[id]`，而是调 `computeBase(get)`
2. **动态 modifier**：`recomputeStat()` 时除了折叠静态 modifier，还调用动态 provider 的 `compute(get)`
3. **失效传播**：当某个属性的 cache 被清除时，顺着依赖图把所有 downstream 属性一起标脏

结果是：

- 不需要一套额外的“刷新 API”
- 也不需要事件订阅式的细粒度人工维护
- 只靠 cache invalidation + lazy recompute 就能覆盖这两类问题

---

## 3. 数据结构

### 3.1 AttrDef 扩展

```ts
interface AttrDef {
  id: AttrId;
  name: string;
  defaultBase: number;
  clampMin?: number;
  clampMax?: number;
  integer?: boolean;

  computeBase?: (get: (attrId: AttrId) => number) => number;
  dependsOn?: AttrId[];
}
```

### 示例——PATK

当前默认内容的 `PATK` 更接近下面这种写法：

```ts
{
  id: ATTR.PATK,
  name: "物理攻击力",
  defaultBase: 0,
  integer: true,
  computeBase: (get) =>
    get(ATTR.WEAPON_ATK) * (1 + K_SCALING * Math.sqrt(get(ATTR.PHYS_POTENCY))),
  dependsOn: [ATTR.WEAPON_ATK, ATTR.PHYS_POTENCY],
}
```

也就是说，一级属性不会直接写死在 `PATK` 公式里，而是先汇聚到 `PHYS_POTENCY`。

### 3.2 DynamicModifierProvider

```ts
interface DynamicModifierProvider {
  sourceId: string;
  targetAttrs: AttrId[];
  dependsOn: AttrId[];
  compute: (get: (id: AttrId) => number) => Modifier[];
}
```

### 示例——基于 INT 提升治疗量

```ts
{
  sourceId: "talent:guardian_prayer:3",
  targetAttrs: [ATTR.HEAL_POWER],
  dependsOn: [ATTR.INT],
  compute: (get) => [{
    stat: ATTR.HEAL_POWER,
    op: "flat",
    value: get(ATTR.INT) * 0.002,
    sourceId: "talent:guardian_prayer:3",
  }],
}
```

### 3.3 AttrSet 扩展

```ts
interface AttrSet {
  base: Record<string, number>;
  modifiers: Modifier[];
  cache: Record<string, number>;
  dynamicProviders: DynamicModifierProvider[];
  depGraph: Record<string, Set<string>>;
}
```

`dynamicProviders` 和 `depGraph` 都是运行时派生数据，不进存档。读档时由 `rebuildCharacterDerived()` 重建。

---

## 4. invalidation 传播

当一个属性变化时，不能只删掉它自己的 cache，还必须把依赖它的属性一起标脏：

```ts
function invalidateStat(set: AttrSet, stat: string): void {
  if (!(stat in set.cache)) return;
  delete set.cache[stat];
  const dependents = set.depGraph[stat];
  if (dependents) {
    for (const dep of dependents) {
      invalidateStat(set, dep);
    }
  }
}
```

`addModifiers()` / `removeModifiersBySource()` / `addDynamicProvider()` 都依赖这条路径传播失效。

---

## 5. recomputeStat 的关键变化

`recomputeStat()` 现在要做三件事：

1. 计算 base（静态 base 或 `computeBase`）
2. 折叠静态 modifiers
3. 折叠动态 provider 现算出来的 modifiers

最后再统一：

- clamp
- 整数取整
- 写回 cache

### 整数取整（已修正）

旧文档曾写 `integer: true` 时使用 `Math.floor`。当前实现不是这样。

当前 runtime 的规则是：

```ts
if (def.integer) v = Math.round(v)
```

所以所有关于成长、小数属性和 affix 的说明，都应该以 **round** 为准，而不是 floor。

---

## 6. Provider 管理 API

当前实现已经有：

- `addDynamicProvider()`
- `removeDynamicProvider()`
- `rebuildDepGraph()`

语义分别是：

- 安装 provider，并把它影响的目标属性标脏
- 移除 provider，并重建依赖图
- 在读档或整体重建后，从头生成完整依赖图

---

## 7. 防环

`recomputeStat()` 入口维护一个模块级 `recomputing: Set<string>`。

如果出现：

```text
A -> B -> A
```

这样的依赖环，会立即 throw。

这符合 alpha 阶段策略：

- 环依赖属于内容设计错误
- 应该尽早暴露，而不是静默容错

---

## 8. 端到端例子

### 8.1 STR / DEX 变化后，PATK 自动更新

```text
1. 装备或 buff 改变一级属性
2. 对应上游属性 cache 被删掉
3. depGraph 把 PHYS_POTENCY 和 PATK 一起标脏
4. 下次读取 PATK 时：
   先重算 PHYS_POTENCY，再重算 PATK
```

### 8.2 战斗中 INT buff 改变治疗量

```text
1. +INT buff 安装
2. INT 被标脏
3. depGraph 把依赖 INT 的 HEAL_POWER 一起标脏
4. 下次治疗时，provider 读到新的 INT，得到新的治疗量
```

### 8.3 buff 过期自动回落

```text
1. +INT buff 移除
2. INT 被再次标脏
3. 下游属性跟着失效
4. 下次读取时自然回到较低值
```

---

## 9. 结论

这套机制的核心不是“多加几个刷新点”，而是把下面三件事统一到一条求值路径上：

- 派生 base
- 动态 modifier
- cache invalidation 传播

这样技能、装备、成长、buff 才能在同一个属性系统里长期共存，而不会不断补临时刷新逻辑。

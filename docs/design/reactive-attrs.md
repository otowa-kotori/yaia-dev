# 响应式属性：派生 base 与动态 modifier

> 依赖：[combat-formula.md](./combat-formula.md), [skill-system.md](./skill-system.md)  
> 被依赖：attribute 模块实现  
> **状态**：已实现（`src/core/entity/attribute/index.ts`，`src/core/content/types.ts`）

---

## 1. 要解决的问题

当前属性系统只处理**静态 modifier**——安装时数值就确定，直到被移除都不变。但技能系统引入了两类新需求：

### 1.1 派生 base

`面板 PATK = 武器ATK × (1 + k × √STR) × 被动乘数 + flat`（来自 combat-formula.md）。PATK 的 base 不是一个写死的数字，它取决于 STR 的最终值。STR 变了（升级、buff、装备），PATK 应该自动过期。

### 1.2 动态 modifier

技能"基于 INT 提升治疗量"。effect 安装时往目标身上加一条 `{ stat: HEAL_POWER, op: "flat", value: INT * 0.1 }` modifier。如果之后 INT 因为战斗中的 buff 变了，这条 modifier 的 value 就过期了。

### 1.3 为什么不能用检查点批量刷新

直觉方案是"装备切换 / 天赋升级后遍历刷新"。但这遗漏了战斗中 buff 导致的属性变化——一个 +INT buff 安装后，依赖 INT 的 modifier 不会被刷新，直到下一个检查点（可能是战斗结束后才触发）。

真正的触发条件应该是**属性值变了**，不是某个宽泛操作发生了。

---

## 2. 核心思路：统一 lazy invalidation

当前属性系统已经是 lazy 的——`getAttr` 发现 cache miss 才 `recomputeStat`。新需求可以自然融入：

1. **派生 base**：`recomputeStat` 时不读 `set.base[id]`，而是调一个函数。函数内部读其他属性 → 递归触发它们的 lazy recompute。
2. **动态 modifier**：`recomputeStat` 时除了折叠静态 modifier，还调用动态 provider 函数现算。函数内部同理读其他属性。
3. **invalidation 传播**：当某个属性的 cache 被清除时（因为 modifier 安装/移除），顺着依赖图向下传播，把所有依赖它的属性 cache 也清除。

一切靠 cache invalidation 传播 + lazy recompute，不需要显式的"刷新"调用或回调注册。

---

## 3. 数据结构

### 3.1 AttrDef 扩展

```ts
interface AttrDef {
  // ---- 已有字段（不变） ----
  id: AttrId;
  name: string;
  defaultBase: number;
  clampMin?: number;
  clampMax?: number;
  integer?: boolean;

  // ---- 新增（可选，ContentDb 侧，可持有函数） ----

  /**
   * 派生 base 计算函数。如果提供，recomputeStat 时用它的返回值
   * 替代 set.base[id]。内部通过 get() 读其他属性的 final 值。
   */
  computeBase?: (get: (attrId: AttrId) => number) => number;

  /**
   * computeBase 读取了哪些属性。用于 invalidation 传播。
   * 只在有 computeBase 时有意义。
   */
  dependsOn?: AttrId[];
}
```

**示例——PATK**：

```ts
{
  id: "attr.patk" as AttrId,
  name: "物理攻击力",
  defaultBase: 0,
  integer: true,
  computeBase: (get) => {
    const weaponAtk = get(ATTR.WEAPON_ATK);
    const str = get(ATTR.STR);
    return weaponAtk * (1 + 0.3 * Math.sqrt(str));
  },
  dependsOn: [ATTR.WEAPON_ATK, ATTR.STR],
}
```

### 3.2 DynamicModifierProvider

```ts
interface DynamicModifierProvider {
  /** 唯一标识，用于安装/卸载时定位。 */
  sourceId: string;
  /** 这个 provider 输出的 modifier 影响哪些属性。 */
  targetAttrs: AttrId[];
  /** 它读取哪些属性来计算 modifier value。 */
  dependsOn: AttrId[];
  /** recomputeStat 时被调用。get() 读其他属性的 final 值。 */
  compute: (get: (id: AttrId) => number) => Modifier[];
}
```

**示例——基于 INT 提升治疗量**：

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
  // ---- 已有（不变） ----
  base: Record<string, number>;
  modifiers: Modifier[];
  cache: Record<string, number>;

  // ---- 新增（非持久化，rebuild on load） ----

  /** 动态 modifier 提供者。recomputeStat 时调用 compute 获取当前值。 */
  dynamicProviders: DynamicModifierProvider[];

  /**
   * 反向依赖图：stat → 依赖它的 stat 集合。
   * 由 AttrDef.dependsOn + DynamicModifierProvider.dependsOn 汇总生成。
   * invalidation 时顺着这张图向下传播。
   */
  depGraph: Record<string, Set<string>>;
}
```

`dynamicProviders` 和 `depGraph` 都是运行时派生数据，不进存档。读档时由 `rebuildCharacterDerived` 重建（和 `modifiers`、`cache` 同理）。

---

## 4. invalidation 传播

当前的 `addModifiers` / `removeModifiersBySource` 在清除 cache 时只清除直接相关的 stat。新方案改为递归传播：

```ts
function invalidateStat(set: AttrSet, stat: string): void {
  if (!(stat in set.cache)) return;    // 已经脏了，不重复传播
  delete set.cache[stat];
  const dependents = set.depGraph[stat];
  if (dependents) {
    for (const dep of dependents) {
      invalidateStat(set, dep);
    }
  }
}
```

改动点：

| 现有函数 | 改动 |
|----------|------|
| `addModifiers` | `delete set.cache[m.stat]` → `invalidateStat(set, m.stat)` |
| `removeModifiersBySource` | 同上 |
| `invalidateAttrs` | 清整个 cache（不变，已经全脏了） |

### depGraph 的构建

depGraph 在两个时机被更新：

1. **rebuildCharacterDerived 时**：遍历 `attrDefs`，把所有 `dependsOn` 边加入图。
2. **addDynamicProvider 时**：把 provider 的 `dependsOn → targetAttrs` 边加入图。
3. **removeDynamicProvider 时**：重建图（provider 数量少，全量重建即可）。

```ts
function rebuildDepGraph(
  set: AttrSet,
  attrDefs: Record<string, AttrDef>,
): void {
  set.depGraph = {};
  // 来自 AttrDef.dependsOn（派生 base）
  for (const def of Object.values(attrDefs)) {
    if (def.dependsOn) {
      for (const dep of def.dependsOn) {
        (set.depGraph[dep] ??= new Set()).add(def.id);
      }
    }
  }
  // 来自 DynamicModifierProvider
  for (const p of set.dynamicProviders) {
    for (const dep of p.dependsOn) {
      for (const target of p.targetAttrs) {
        (set.depGraph[dep] ??= new Set()).add(target);
      }
    }
  }
}
```

---

## 5. recomputeStat 的变化

```ts
// 调用栈环检测（模块级临时 Set，per-recompute-chain 使用）
const recomputing = new Set<string>();

function recomputeStat(
  set: AttrSet,
  attrId: string,
  attrDefs: Readonly<Record<string, AttrDef>>,
): void {
  // ---- 环检测 ----
  if (recomputing.has(attrId)) {
    throw new Error(`Circular attr dependency: ${attrId}`);
  }
  recomputing.add(attrId);

  try {
    const def = attrDefs[attrId];
    const get = (id: AttrId) => getAttr(set, id, attrDefs);

    // ---- base ----
    const base = def?.computeBase
      ? def.computeBase(get)
      : set.base[attrId] ?? def?.defaultBase ?? 0;

    // ---- 静态 modifiers（和现在完全一样） ----
    let flat = 0, pctAdd = 0, pctMult = 1;
    for (const m of set.modifiers) {
      if (m.stat !== attrId) continue;
      switch (m.op) {
        case "flat":     flat += m.value; break;
        case "pct_add":  pctAdd += m.value; break;
        case "pct_mult": pctMult *= (1 + m.value); break;
      }
    }

    // ---- 动态 modifiers（新增） ----
    for (const provider of set.dynamicProviders) {
      if (!provider.targetAttrs.includes(attrId as AttrId)) continue;
      const mods = provider.compute(get);
      for (const m of mods) {
        if (m.stat !== attrId) continue;
        switch (m.op) {
          case "flat":     flat += m.value; break;
          case "pct_add":  pctAdd += m.value; break;
          case "pct_mult": pctMult *= (1 + m.value); break;
        }
      }
    }

    // ---- clamp / floor / cache（和现在完全一样） ----
    let v = (base + flat) * (1 + pctAdd) * pctMult;
    if (def) {
      if (def.clampMin !== undefined && v < def.clampMin) v = def.clampMin;
      if (def.clampMax !== undefined && v > def.clampMax) v = def.clampMax;
      if (def.integer) v = Math.floor(v);
    }
    set.cache[attrId] = v;
  } finally {
    recomputing.delete(attrId);
  }
}
```

---

## 6. Provider 管理 API

```ts
function addDynamicProvider(
  set: AttrSet,
  provider: DynamicModifierProvider,
  attrDefs: Readonly<Record<string, AttrDef>>,
): void {
  set.dynamicProviders.push(provider);
  // 更新 depGraph
  for (const dep of provider.dependsOn) {
    for (const target of provider.targetAttrs) {
      (set.depGraph[dep] ??= new Set()).add(target);
    }
  }
  // 目标属性标脏
  for (const t of provider.targetAttrs) {
    invalidateStat(set, t);
  }
}

function removeDynamicProvider(
  set: AttrSet,
  sourceId: string,
  attrDefs: Readonly<Record<string, AttrDef>>,
): void {
  const idx = set.dynamicProviders.findIndex(p => p.sourceId === sourceId);
  if (idx < 0) return;
  const provider = set.dynamicProviders[idx];
  set.dynamicProviders.splice(idx, 1);
  // 目标属性标脏
  for (const t of provider.targetAttrs) {
    invalidateStat(set, t);
  }
  // 重建 depGraph（provider 数量少，全量重建代价低）
  rebuildDepGraph(set, attrDefs);
}
```

---

## 7. 防环

环检测由 `recomputing: Set<string>` 在 `recomputeStat` 入口执行。如果发现某个属性正在被计算的过程中又被请求计算（A→B→A），立刻 throw。

合法的依赖图必须是 **DAG**。如果出现环，说明内容设计有逻辑问题（"基于 HP 提升 INT，基于 INT 提升 HP"），应该修改内容定义。alpha 阶段不兜底——throw 暴露问题。

---

## 8. 端到端场景走查

### 8.1 PATK 随 STR 自动更新

```
1. 角色有 STR base=20, PATK 由 computeBase 派生
2. 穿装备加了 STR flat +5 → addModifiers → invalidateStat("attr.str")
   → depGraph["attr.str"] 包含 "attr.patk" → invalidateStat("attr.patk")
3. 下次 getAttr(ATTR.PATK) → cache miss → recomputeStat
   → 调用 computeBase → get(ATTR.STR) → cache miss → recomputeStat(STR)
   → STR final = 25 → 返回 → PATK base = weaponAtk * (1 + 0.3*√25) → 缓存
```

### 8.2 战斗中 buff 改变 INT → 依赖 INT 的 modifier 自动更新

```
1. 圣女有 effect "基于 INT 提升 HEAL_POWER"（DynamicModifierProvider）
2. 法师给圣女上了 +INT buff → addModifiers([{ stat: INT, op: flat, value: 30 }])
   → invalidateStat("attr.int")
   → depGraph["attr.int"] 包含 "attr.heal_power" → invalidateStat("attr.heal_power")
3. 圣女下次治疗时读 HEAL_POWER → cache miss → recomputeStat
   → 折叠静态 modifiers + 调用 provider.compute(get)
   → provider 内部 get(ATTR.INT) → 读到新 INT → 返回更大的 flat value → 治疗量提升
```

### 8.3 buff 过期 → 自动回落

```
1. +INT buff 到期 → removeModifiersBySource → invalidateStat("attr.int")
   → 传播到 "attr.heal_power"
2. 下次读 HEAL_POWER → provider 读到较低的 INT → 回到原来的数值
```

### 8.4 天赋升级刷新 provider

```
1. 天赋 guardian_prayer 从 Lv3 升到 Lv4
2. removeDynamicProvider("talent:guardian_prayer:3")
   → HEAL_POWER 标脏 → depGraph 重建
3. addDynamicProvider({ sourceId: "talent:guardian_prayer:4", ... })
   → HEAL_POWER 标脏
4. 下次读 HEAL_POWER → 用新 provider（Lv4 系数更高）计算
```

---

## 9. 性能

| 操作 | 开销 | 频率 |
|------|------|------|
| `getAttr`（cache hit） | O(1) 字典查找 | 每次伤害/治疗/intent 判定 |
| `getAttr`（cache miss）| O(modifiers + providers) 折叠 | 只在 cache 被 invalidate 后首次读取 |
| `invalidateStat` 传播 | O(depGraph 深度) | 只在 addModifiers / removeModifiers 时 |
| `addDynamicProvider` | O(deps × targets) 更新 depGraph | effect 安装时 |
| `removeDynamicProvider` | O(所有 provider) 重建 depGraph | effect 移除时 |

依赖图节点数 = 属性数量（~15），边数 = 派生关系数（~10）。所有操作对这个量级来说是 O(1) 级别。

---

## 10. 持久化

以下字段**不进存档**，读档时由 `rebuildCharacterDerived` 重建：

- `attrSet.dynamicProviders`：从角色身上的 activeEffects + 天赋 重新安装
- `attrSet.depGraph`：从 attrDefs + dynamicProviders 重新构建
- `attrSet.cache`：全部标脏，lazy recompute

和现有的 `modifiers` / `cache` 处理方式完全一致。

---

## 11. 与 skill-system.md 的关系

skill-system.md 中涉及属性刷新的场景全部由本机制覆盖：

| skill-system 场景 | 本机制的处理 |
|-------------------|-------------|
| 天赋升级刷新被动 effect | 卸载旧 provider + 安装新 provider |
| "基于 INT 提升 X" | DynamicModifierProvider |
| PATK = f(STR, WEAPON_ATK) | AttrDef.computeBase + dependsOn |
| 战斗中 buff 改变属性 → 依赖链刷新 | invalidation 传播 + lazy recompute |

skill-system.md 不需要定义自己的刷新机制——引用本文档即可。

---

## 开放问题

- [ ] `computeBase` 内是否允许读 `set.base` 里的其他属性（而非 final 值）？当前方案全部读 final 值，语义更统一，但如果某些派生只想看 base 值则需要额外的 `getBase` API。
- [ ] `DynamicModifierProvider.compute` 返回的 modifier 数量是否可变？（比如某些条件下返回空数组。）当前方案允许，但 `targetAttrs` 声明需要覆盖所有可能输出的 stat。
- [ ] `recomputing` Set 是模块级变量——在并发场景（将来 web worker？）下需要改为 per-call-chain 传递。alpha 阶段不需要担心。

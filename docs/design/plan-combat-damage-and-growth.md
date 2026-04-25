# 落地计划：伤害公式 + 属性成长 + 4 角色初始配置

> 依赖：[combat-formula.md](./combat-formula.md), [reactive-attrs.md](./reactive-attrs.md), [jobs.md](./jobs.md), [equipment.md](./equipment.md)  
> **状态**：待实施

---

## 0. 背景与设计决策

### 当前问题

1. **伤害公式是占位**：`strikeEffect` 用的 `atk_vs_def` 是线性减法 `max(1, atk - def)`，和 combat-formula.md 的 ratio-power 破甲方案完全不同。
2. **属性体系缺失**：没有 PATK/MATK/PDEF/MRES 等导出属性；没有武器攻击力和一级属性的乘法关系。
3. **升级无成长**：levelup 只改 `pc.level`，不增加 STR/DEX/INT/HP 等一级属性。
4. **只有 2 角色**：需要按 jobs.md 配满 4 职业。

### 核心决策

1. **面板攻击力由 reactive-attrs 驱动**：PATK 和 MATK 是 `AttrDef.computeBase` 派生属性，不需要新增 formula kind 来计算面板。
2. **中间聚合属性**：引入 `PHYS_POTENCY`（物理潜力）和 `MAG_POTENCY`（魔法潜力），汇聚一级属性后统一喂入 `√` 缩放。这样：
   - 骑士的 PHYS_POTENCY = STR×1.0
   - 游侠的 PHYS_POTENCY = DEX×1.0
   - 将来被动 "DEX 也贡献物攻" → 额外往 PHYS_POTENCY 追加 DEX flat，和原有的加和后统一过 √，数学正确
3. **伤害类型由 Effect 决定**：每个 EffectDef 的 formula 选择 `phys_damage_v1`（读 PATK/PDEF）或 `magic_damage_v1`（读 MATK/MRES），不由角色决定。
4. **人怪同模**：怪物和玩家角色用同一套属性链和伤害公式。
5. **ATK/DEF 退役**：面板物攻 = PATK，武器底值 = WEAPON_ATK，物防 = PDEF。旧 ATK/DEF 删除。

---

## 1. 属性链总览

```
一级属性层          聚合层           面板层
─────────          ─────           ─────
STR ──┐                            
      ├─(provider)──→ PHYS_POTENCY ──┐
DEX ──┘                               ├─(computeBase)──→ PATK
                        WEAPON_ATK ───┘

INT ──(provider)───→ MAG_POTENCY ───┐
                        WEAPON_MATK ──┘─(computeBase)──→ MATK

装备 ──(modifier)──→ PDEF        （纯 flat 堆叠，不由属性缩放）
来源待定 ─────────→ MRES         （百分比减伤，上限 80%）
```

### 面板物攻公式

```
PATK = WEAPON_ATK × (1 + k × √PHYS_POTENCY) × (1 + Σpct_add) × Πpct_mult + Σflat
```

- `k = 0.3`（和 combat-formula.md 一致）
- `WEAPON_ATK × (1 + k × √PHYS_POTENCY)` 是 `computeBase` 的返回值
- 后面的 modifier 堆叠由 attribute 系统自动处理

MATK 同理，读 WEAPON_MATK 和 MAG_POTENCY。

### PHYS_POTENCY / MAG_POTENCY

纯 modifier 驱动的聚合属性，没有 `computeBase`，`defaultBase = 0`。

各角色通过 `physScaling` / `magScaling` 配置，在 `rebuildCharacterDerived` 中安装 DynamicModifierProvider。

---

## 2. 新增属性常量

| 属性 ID | 名称 | defaultBase | 来源 | 说明 |
|---------|------|-------------|------|------|
| `attr.weapon_atk` | 武器攻击 | 1 | 武器 modifier (flat) | 赤手 = 1 |
| `attr.weapon_matk` | 武器法攻 | 0 | 法杖 modifier (flat) | 赤手无法攻 = 0 |
| `attr.phys_potency` | 物理潜力 | 0 | DynamicModifierProvider | 聚合一级属性 |
| `attr.mag_potency` | 魔法潜力 | 0 | DynamicModifierProvider | 聚合一级属性 |
| `attr.patk` | 物理攻击力 | 0 | computeBase(WEAPON_ATK, PHYS_POTENCY) | 面板白字物攻 |
| `attr.matk` | 魔法攻击力 | 0 | computeBase(WEAPON_MATK, MAG_POTENCY) | 面板白字魔攻 |
| `attr.pdef` | 物理防御 | 0 | 装备 modifier (flat) | 原 DEF 改名 |
| `attr.mres` | 魔法抗性 | 0 | 来源待定 | 百分比减伤，clampMax=0.8 |

**删除**：`attr.atk`、`attr.def`。

---

## 3. 角色属性缩放配置

### 数据结构

`PlayerCharacter` 新增字段（持久化）：

```ts
/** HeroConfig 的 id，用于在运行时查表获取 growth / physScaling / magScaling。
 *  这三个字段属于内容层职责，不持久化到 PC 实例上。 */
heroConfigId: string;
```

`HeroConfig`（ContentDb.starting）新增：

```ts
baseAttrs?: Partial<Record<AttrId, number>>;    // 覆盖 AttrDef.defaultBase
growth?: Partial<Record<AttrId, number>>;       // 每级增量，float 合法
physScaling?: { attr: AttrId; ratio: number }[]; // 贡献 PHYS_POTENCY
magScaling?:  { attr: AttrId; ratio: number }[]; // 贡献 MAG_POTENCY
```

`MonsterDef` 新增：

```ts
physScaling?: { attr: AttrId; ratio: number }[];  // 默认 [{STR, 1.0}]
magScaling?:  { attr: AttrId; ratio: number }[];  // 默认 [{INT, 1.0}]
```

### 四角色配置

| 角色 | physScaling | magScaling |
|------|-------------|------------|
| 骑士 | `[{STR, 1.0}]` | `[{INT, 1.0}]` |
| 游侠 | `[{DEX, 1.0}]` | `[{INT, 1.0}]` |
| 法师 | `[{STR, 1.0}]` | `[{INT, 1.0}]` |
| 圣女 | `[{STR, 1.0}]` | `[{INT, 1.0}]` |

法师和圣女的 physScaling 用 **STR**（而非 INT）：因为她们 STR 基础值低（3）且无成长，赤手 PATK 约 1.5，接近于零，不会让魔法职业有异常高的物攻。若改用 INT，法师 Lv25 INT≈72 时 PATK 会高于骑士，明显不合理。

### DynamicModifierProvider 安装

`rebuildCharacterDerived` 中，对 PlayerCharacter 和 Enemy 统一执行：

```ts
for (const { attr, ratio } of scaling.physScaling) {
  addDynamicProvider(c.attrs, {
    sourceId: `phys_potency_scaling:${attr}`,
    targetAttrs: [ATTR.PHYS_POTENCY],
    dependsOn: [attr],
    compute: (get) => [{
      stat: ATTR.PHYS_POTENCY, op: "flat",
      value: get(attr) * ratio,
      sourceId: `phys_potency_scaling:${attr}`,
    }],
  }, attrDefs);
}
// magScaling 同理 → MAG_POTENCY
```

---

## 4. 属性成长

### 成长表

| 属性 | 骑士 Lv1 | /级 | 游侠 Lv1 | /级 | 法师 Lv1 | /级 | 圣女 Lv1 | /级 |
|------|----------|-----|----------|-----|----------|-----|----------|-----|
| MAX_HP | 180 | +20 | 120 | +14 | 90 | +10 | 110 | +12 |
| MAX_MP | 30 | +2 | 40 | +3 | 80 | +8 | 60 | +6 |
| STR | 10 | +2.5 | 6 | +1 | 3 | — | 3 | — |
| DEX | 5 | +1 | 10 | +2.5 | 4 | +0.5 | 4 | +0.5 |
| INT | 3 | — | 3 | — | 10 | +2.5 | 8 | +2 |
| SPEED | 35 | +1 | 45 | +1.5 | 30 | +1 | 32 | +1 |

说明：
- 主属性每级 +2~2.5，副属性 0~1。`integer: true` → 最终值取 floor，小数成长通过 base 累加自然运作。
- 骑士 HP 最高（180 → 680 @Lv25），法师最脆（90 → 330）。
- SPEED：游侠最快（45 → 81），法师最慢（30 → 54）。

### 实现

`grantCharacterXp` 中，level++ 之后：

```ts
if (pc.growth) {
  for (const [attrId, delta] of Object.entries(pc.growth)) {
    pc.attrs.base[attrId] = (pc.attrs.base[attrId] ?? 0) + delta;
  }
  invalidateAttrs(pc.attrs);
}
```

---

## 5. 初始装备

| 角色 | 武器 ID | 名称 | 关键 modifier |
|------|---------|------|---------------|
| 骑士 | `item.weapon.training_sword` | 训练木剑 | WEAPON_ATK flat +4 |
| 游侠 | `item.weapon.training_bow` | 训练短弓 | WEAPON_ATK flat +3, SPEED flat +2 |
| 法师 | `item.weapon.training_staff` | 训练法杖 | WEAPON_MATK flat +3 |
| 圣女 | `item.weapon.training_scepter` | 见习权杖 | WEAPON_MATK flat +2, MAX_MP flat +10 |

铜剑：WEAPON_ATK flat +8（对齐 combat-formula.md 的铜剑 ATK 8）。

铜弓 / 铜法杖暂不实装，位置预留。

---

## 6. 伤害公式

### 两个新 FormulaRef kind

```ts
/** 物理伤害：有效攻击 × 破甲系数，破甲系数由 PDEF/有效攻击 比例决定 */
interface PhysDamageV1Formula {
  kind: "phys_damage_v1";
  skillMul?: number;    // 技能（段）系数，default 1.0；每段独立代入破甲公式
  K?: number;           // ratio-power 宽松度，default 0.8
  p?: number;           // ratio-power 急转指数，default 1.5
  floor?: number;       // 保底倍率，default 0.1（有效攻击的 10%）
}

/** 魔法伤害 = MATK × skillMul × (1 - MRES) */
interface MagicDamageV1Formula {
  kind: "magic_damage_v1";
  skillMul?: number;    // 技能系数，default 1.0
}
```

### evalFormula 实现

```ts
case "phys_damage_v1": {
  // 两步计算：
  //   有效攻击 = PATK × skillMul
  //   excess   = max(0, PDEF / 有效攻击 - 1)
  //   破甲系数 = max(floor, K / (K + excess^p))
  //   最终伤害 = ⌊有效攻击 × 破甲系数⌋
  const patk     = varOrZero(vars, "patk");
  const pdef     = varOrZero(vars, "pdef");
  const skillMul = ref.skillMul ?? 1;
  const K        = ref.K ?? 0.8;
  const p        = ref.p ?? 1.5;
  const fl       = ref.floor ?? 0.1;
  const effectiveAtk = patk * skillMul;
  if (effectiveAtk <= 0) return 0;
  const excess = Math.max(0, pdef / effectiveAtk - 1);
  const armorCoeff = Math.max(fl, K / (K + Math.pow(excess, p)));
  return Math.floor(effectiveAtk * armorCoeff);
}

case "magic_damage_v1": {
  const matk     = varOrZero(vars, "matk");
  const mres     = varOrZero(vars, "mres");
  const skillMul = ref.skillMul ?? 1;
  return Math.floor(matk * skillMul * (1 - mres));
}
```

### buildFormulaContext 变更

```ts
// 新增
patk: getAttr(source, ATTR.PATK, attrDefs),
matk: getAttr(source, ATTR.MATK, attrDefs),
pdef: getAttr(target, ATTR.PDEF, attrDefs),
mres: getAttr(target, ATTR.MRES, attrDefs),

// 保留（供非伤害公式使用）
source_str, source_dex, source_int, source_wis, ...

// 删除
atk, def                    // 这两个属性已不存在
```

### strikeEffect 改动

```ts
export const strikeEffect: EffectDef = {
  id: "effect.combat.strike" as EffectId,
  kind: "instant",
  magnitudeMode: "damage",
  formula: { kind: "phys_damage_v1" },  // 原 atk_vs_def → phys_damage_v1
};
```

---

## 7. 怪物定义改动

人怪同模：ATK → WEAPON_ATK、DEF → PDEF、新增 physScaling/magScaling。

```ts
export const slime: MonsterDef = {
  id: "monster.slime",
  level: 1,
  physScaling: [{ attr: ATTR.STR, ratio: 1.0 }],  // NEW
  baseAttrs: {
    [ATTR.MAX_HP]: 30,
    [ATTR.WEAPON_ATK]: 4,     // 原 ATK
    [ATTR.PDEF]: 1,           // 原 DEF
    [ATTR.SPEED]: 12,
  },
  // ... 其余不变
};
```

怪物目前 STR/DEX/INT base 都是 0 → PHYS_POTENCY = 0 → PATK = WEAPON_ATK × (1 + 0) = WEAPON_ATK。完全向后兼容。

---

## 8. 升级商店改动

| 升级 | 原 modifier | 改为 |
|------|------------|------|
| 战士训练 | ATK flat +2 | WEAPON_ATK flat +2（全员武器底值 +2） |
| 护甲强化 | DEF flat +1 | PDEF flat +1 |

---

## 9. Lv1 战斗速算验证

### 骑士（训练木剑）vs 史莱姆

```
骑士: WEAPON_ATK = 1(base) + 4(剑) = 5, STR = 10
      PHYS_POTENCY = 10 (STR × 1.0)
      PATK = 5 × (1 + 0.3 × √10) = 5 × 1.949 = 9 (floor)
      PDEF = 0

史莱姆: WEAPON_ATK = 4, STR = 0
        PHYS_POTENCY = 0
        PATK = 4 × (1 + 0) = 4
        PDEF = 1

骑士 → 史莱姆:
  有效攻击 = 9 × 1.0 = 9
  excess = max(0, 1/9 - 1) = 0   → 已破甲
  伤害 = 9

史莱姆 → 骑士:
  有效攻击 = 4
  excess = max(0, 0/4 - 1) = 0   → 已破甲
  伤害 = 4

骑士 180 HP, 史莱姆 30 HP
骑士 ~4 击杀死（约 100 tick），期间史莱姆打 ~1 次
骑士 HP: 180 → 176   安全 ✓
```

### 游侠（训练短弓）vs 史莱姆

```
游侠: WEAPON_ATK = 1 + 3 = 4, DEX = 10
      PHYS_POTENCY = 10
      PATK = 4 × (1 + 0.3 × √10) = 4 × 1.949 = 7
      SPEED = 45 + 2(弓) = 47

游侠 → 史莱姆:
  伤害 = 7 (excess=0)

~5 击杀死，但游侠 SPD 47 远高于骑士 35 → 实际清场时间更短
```

### 换武器跳跃感

```
Lv15 骑士, STR = 10 + 14×2.5 = 45
  训练木剑(+4):  PATK = 5 × (1 + 0.3×√45) = 5 × 3.01 = 15
  铜剑(+8):      PATK = 9 × (1 + 0.3×√45) = 9 × 3.01 = 27
  → 换武器: 15 → 27 (+80%)

vs PDEF=20 的怪:
  木剑: excess = max(0, 20/15 - 1) = 0.33
        armorCoeff = 0.8/(0.8 + 0.33^1.5) = 0.8/0.99 = 0.81
        伤害 = 15 × 0.81 = 12
  铜剑: excess = max(0, 20/27 - 1) = 0 → 已破甲
        伤害 = 27
  → 换武器: 12 → 27 (2.25 倍跳跃，含破甲质变) ✓
```

---

## 10. 序列化

### 新增持久化字段

- `PlayerCharacter.heroConfigId`：字符串，指向 HeroConfig.id，用于运行时查 growth/physScaling/magScaling

### 不持久化（运行时重建）的字段

以下三项从内容层读取，**不写入存档**：
- `growth`（在 HeroConfig）
- `physScaling` / `magScaling`（在 HeroConfig / MonsterDef）

### 继续排除的派生字段

- `attrs.modifiers`、`attrs.cache`、`attrs.dynamicProviders`、`attrs.depGraph`
- `abilities`

---

## 11. 完整改动清单

| # | 改动 | 文件 |
|---|------|------|
| 1 | ATTR 新增 `PATK` `MATK` `WEAPON_ATK` `WEAPON_MATK` `PHYS_POTENCY` `MAG_POTENCY` `PDEF` `MRES`；删除 `ATK` `DEF` | `entity/attribute/index.ts` |
| 2 | AttrDef 注册：PATK/MATK 带 `computeBase`+`dependsOn`；其余新属性基础定义；删除旧 ATK/DEF 定义 | `content/index.ts` |
| 3 | FormulaRef 新增 `PhysDamageV1Formula` `MagicDamageV1Formula` | `infra/formula/types.ts` |
| 4 | evalFormula 新增两个 case | `infra/formula/eval.ts` |
| 5 | `buildFormulaContext` 新增 `patk`/`matk`/`pdef`/`mres` 变量；删除 `atk`/`def` | `behavior/effect/index.ts` |
| 6 | `strikeEffect` 改用 `phys_damage_v1` | `content/index.ts` |
| 7 | PC 新增 `growth`、`physScaling`、`magScaling` 字段 | `entity/actor/types.ts` |
| 8 | `HeroConfig` 新增 `baseAttrs`、`growth`、`physScaling`、`magScaling` 字段 | `content/types.ts` |
| 9 | `grantCharacterXp` 升级时应用 growth + invalidateAttrs | `growth/leveling/xp.ts` |
| 10 | `createPlayerCharacter` 接受并传递 `growth`、`physScaling`、`magScaling` | `entity/actor/factory.ts` |
| 11 | `rebuildCharacterDerived` 安装 physScaling/magScaling DynamicModifierProvider | `entity/actor/factory.ts` |
| 12 | `resetToFresh` 传递 `baseAttrs`、`growth`、`physScaling`、`magScaling` 到工厂 | `session/index.ts` |
| 13 | 训练木剑改 WEAPON_ATK；铜剑改 WEAPON_ATK；新增训练短弓/训练法杖/见习权杖 | `content/index.ts` |
| 14 | 怪物定义：ATK→WEAPON_ATK、DEF→PDEF、新增 physScaling | `content/index.ts` |
| 15 | starting heroes 重写：4 角色 + baseAttrs + growth + physScaling + magScaling + startingItems | `content/index.ts` |
| 16 | atkUpgrade 改 WEAPON_ATK flat +2；defUpgrade 改 PDEF flat +1 | `content/index.ts` |
| 17 | `MonsterDef` 新增 physScaling/magScaling 可选字段 | `content/types.ts` |
| 18 | 序列化白名单加 `growth`、`physScaling`、`magScaling` | `save/serialize.ts` |
| 19 | 旧 `atk_vs_def` formula kind 删除 | `infra/formula/types.ts`、`infra/formula/eval.ts` |
| 20 | 测试 fixtures 对齐 | `tests/` |

---

## 12. 不在本次范围

- 怪物数值联调（K/p 参数微调）——需要完整怪物梯度，留给 monsters.md 联调
- 魔法伤害的默认攻击 effect（法师/圣女低系数魔法射线）——技能系统 PR 处理
- 护甲装备（PDEF 来源）——equipment.md 联调
- MRES 具体来源——后续设计，目前写死在角色配置里，英雄MRES初始值为20，怪物为0。
- 暴击系统——combat-formula.md 开放问题
- 技能系统重构（AbilityDef → TalentDef）——skill-system.md 独立 PR

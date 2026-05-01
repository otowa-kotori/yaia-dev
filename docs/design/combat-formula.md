# 属性体系与战斗公式

> **状态**：Phase 0 基线已落地。本文描述当前 runtime 实际使用的公式。

---

## 1. 属性体系

### 一级属性

| 属性 | 主要影响 |
|------|----------|
| **STR** | 物理攻击力缩放 |
| **DEX** | 命中 / 闪避 / 暴击 / 暴击抗性 |
| **INT** | 魔法攻击力缩放 |
| **CON** | 生命上限（×3 → MAX_HP） |

### 导出属性

| 属性 | 说明 |
|------|------|
| **PATK** | 物理攻击力，由武器物攻 × (1 + k × PHYS_POTENCY) 派生 |
| **MATK** | 魔法攻击力，由武器魔攻 × (1 + k × MAG_POTENCY) 派生 |
| **PDEF** | 物理防御；纯装备护甲值，不由属性缩放 |
| **MRES** | 魔法抗性；百分比减伤，上限 0.8 |
| **SPD** | 独立速度属性，影响 ATB 充能速率 |
| **HIT / EVA** | 命中 / 闪避评级（由 DEX ×1 驱动） |
| **CRIT_RATE / CRIT_RES** | 暴击 / 暴击抗性评级（由 DEX ×1 驱动） |
| **HP / MP** | 生存与资源池 |

### 通用缩放

| 缩放 | 公式 |
|------|------|
| CON → MAX_HP | CON × 3 |
| DEX → HIT | DEX × 1 |
| DEX → EVA | DEX × 1 |
| DEX → CRIT_RATE | DEX × 1 |
| DEX → CRIT_RES | DEX × 1 |

---

## 2. 面板攻击力

```text
PATK = floor(WEAPON_ATK × (1 + 0.03 × PHYS_POTENCY))
MATK = floor(WEAPON_MATK × (1 + 0.03 × MAG_POTENCY))
```

k = 0.03，线性缩放。PHYS_POTENCY / MAG_POTENCY 由 physScaling / magScaling 配置汇聚一级属性。

设计原则：
1. 武器必须始终有存在感（是乘法底座）
2. 主属性放大武器，但不淹没武器
3. 线性缩放保证升级后面板数字有明确增长反馈

---

## 3. 速度（SPD）

独立速度属性，不由 DEX 导出。

- 决定 ATB 能量获取速率
- 决定开场先手优势
- 不直接影响伤害

---

## 4. 物理伤害：return-to-line

**正式方案**。Runtime 实现在 `src/core/infra/formula/eval.ts` 的 `phys_damage_v1`。

```text
有效攻击 = PATK × skillMul
x = 有效攻击 / PDEF
a = (1 - t×m) / t
y = t × x^a                      , x ≤ 1
y = (x - 1) + t / (1 + m(x-1))  , x > 1
最终伤害 = floor(PDEF × y)
```

默认参数：`t = 0.25`, `m = 1.0`。

### 行为特征

- **ATK < DEF**（x < 1）：伤害通过 `t × x^a` 平滑趋近 0，不会突然断崖
- **ATK = DEF**（x = 1）：伤害 = `floor(PDEF × t)` = PDEF 的 25%
- **ATK > DEF**（x > 1）：伤害近似 `ATK - DEF`（经典减法模型），但有微小修正
- **PDEF = 0**：退化为 `floor(PATK × skillMul)`（直接全额输出）

### 设计意图

- 允许低攻打高甲时伤害极低（甚至为 0），制造明确的区域数值门槛
- 物理职业确实会被高甲怪卡住
- 一旦攻击力超过防御，成长反馈线性且明确

---

## 5. 魔法伤害

```text
Damage = floor(MATK × skillMul × (1 - MRES))
```

百分比减伤，天然不会出现"完全打不动"。降低 MRES 的手段应比物理减防稀少。

---

## 6. 物理 vs 魔法的分工

| | 物理 | 魔法 |
|---|---|---|
| 防御形式 | PDEF，减法模型（有明确破甲线） | MRES，百分比减伤 |
| 体验 | 会被高甲卡住 | 更稳定，不易完全失效 |
| buff / debuff 收益 | 可能出现质变（突破甲线） | 更偏量变 |
| 多段交互 | 高甲时每段都被克制 | 不因分段吃双重亏 |

---

## 7. 命中率

```text
hitRate = HIT / (HIT + EVA × k_hit), clamp [0.3, 0.95]
```

默认 `k_hit = 1/3`。

同 DEX 时：HIT = EVA = D → rate = D/(D + D/3) = 3/4 = **75%**。

---

## 8. 暴击率

```text
critChance = CRIT_RATE / (CRIT_RATE + CRIT_RES × k_crit), clamp [0, 0.75]
```

默认 `k_crit = 4`。暴击倍率默认 1.5×。

同 DEX 时：rate = D/(D + 4D) = 1/5 = **20%**。

---

## 9. 与当前实现的同步情况

### 已同步

- STR / DEX / INT / CON 四主属性
- PATK / MATK / PDEF / MRES / SPD 五核心导出属性
- SPD 独立驱动 ATB
- HIT / EVA / CRIT_RATE / CRIT_RES 由 DEX ×1 驱动
- 面板公式：线性 k=0.03
- 物理伤害：return-to-line（t=0.25, m=1.0）
- 魔法伤害：百分比减伤
- 命中 / 暴击：contested rating + formula

### 未来扩展方向

- PEN（穿透）属性：来自特定技能 / debuff，不做默认全局属性
- 多段物理与高甲的天然克制关系
- 等级差惩罚机制

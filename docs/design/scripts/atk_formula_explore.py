"""
攻击力导出公式探索 — 对比不同方案在以下场景中的表现:
1. 换武器的跳跃感（前期 vs 后期）
2. 属性成长的贡献
3. 伤害膨胀程度

同时探索物理伤害的破甲线衰减公式。

用法: python scripts/atk_formula_explore.py
输出: docs/design/plots/ 目录下的图表
"""

import math
import os

# ── 尝试 matplotlib，不可用则回退 ASCII ──
try:
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    HAS_MPL = True
except ImportError:
    HAS_MPL = False
    print("⚠ matplotlib 不可用，使用 ASCII 输出")

OUTPUT_DIR = os.path.join(os.path.dirname(__file__), "..", "docs", "design", "plots")
os.makedirs(OUTPUT_DIR, exist_ok=True)

# ═══════════════════════════════════════════
# 第一部分：攻击力导出公式
# ═══════════════════════════════════════════

# ── 假设的武器ATK和属性成长 ──
# 武器 ATK 梯度（3 个 Tier + 强化）
WEAPONS = {
    "T0 训练剑":   4,
    "T1 铜剑":     8,
    "T1 铜剑+3":   11,
    "T2 铁剑":     14,
    "T2 铁剑+5":   20,
}

# 战士 STR 随等级变化（Lv1: 10, 每级+2）
def warrior_str(level):
    return 10 + (level - 1) * 2

# 巡林客 DEX 随等级变化
def ranger_dex(level):
    return 10 + (level - 1) * 2

LEVELS = list(range(1, 31))

# ── 方案 A：纯乘法 ──
# PATK = weapon_atk * (1 + stat * k)
# 问题：后期 stat=60, k=0.05 → 乘数 4.0; 前期 stat=10 → 1.5
# 换武器跳跃 = weapon_diff * (1 + stat * k) → 后期跳跃是前期的 4/1.5 = 2.7 倍
# ✅ 后期换武器依然有感  ⚠ 但伤害也膨胀了 2.7 倍

def formula_mult(weapon_atk, stat, k=0.05):
    return weapon_atk * (1 + stat * k)

# ── 方案 B：加法 ──
# PATK = weapon_atk + stat * c
# 问题：后期 stat=60, c=0.5 → +30; 前期 stat=10 → +5
# 换武器跳跃 = weapon_diff（常数！无论前期后期一样）
# ⚠ 后期属性加成可能超过武器本身 → 武器不再重要

def formula_add(weapon_atk, stat, c=0.5):
    return weapon_atk + stat * c

# ── 方案 C：加法+乘法混合 ──
# PATK = (weapon_atk + flat_bonus) * (1 + stat_ratio)
# flat_bonus 很小（来自技能/天赋），stat_ratio 用 sqrt 或 log 压缩
# 换武器跳跃 = weapon_diff * (1 + stat_ratio) → 被乘数放大但受控

def formula_hybrid_sqrt(weapon_atk, stat, k=0.3):
    """weapon * (1 + k * sqrt(stat))"""
    return weapon_atk * (1 + k * math.sqrt(stat))

def formula_hybrid_log(weapon_atk, stat, k=0.5):
    """weapon * (1 + k * ln(stat))"""
    return weapon_atk * (1 + k * math.log(max(1, stat)))

# ── 方案 D：幂函数压缩 ──
# PATK = weapon_atk * (stat / base_stat) ^ p, p < 1
# 当 p=0.5 时等同于 sqrt 缩放
# 换武器跳跃 = weapon_diff * (stat/base)^p → 后期跳跃更大但增速递减

def formula_power(weapon_atk, stat, base_stat=10, p=0.5):
    return weapon_atk * (stat / base_stat) ** p

# ── 方案 E：武器基础 + stat缩放 分开（破甲线友好） ──
# 分离 "破甲力" 和 "伤害乘数"：
# 破甲力 = weapon_atk （参与破甲判定）
# 最终伤害 = 破甲后基础伤害 * (1 + k * sqrt(stat))
# 这里只算 PATK 等效值，破甲在另一步

def formula_separated(weapon_atk, stat, k=0.3):
    """等效 PATK = weapon_atk * (1 + k * sqrt(stat))，但语义不同"""
    return weapon_atk * (1 + k * math.sqrt(stat))


# ── 分析函数 ──

def analyze_formula(name, fn, **kwargs):
    """分析一个公式的关键指标"""
    results = {}

    # 1. 各等级 + 各武器的 PATK
    for wname, watk in WEAPONS.items():
        values = []
        for lv in LEVELS:
            stat = warrior_str(lv)
            values.append(fn(watk, stat, **kwargs))
        results[wname] = values

    # 2. 换武器跳跃感
    lv1_stat = warrior_str(1)
    lv25_stat = warrior_str(25)

    jump_early = fn(8, lv1_stat, **kwargs) - fn(4, lv1_stat, **kwargs)   # T0→T1 at Lv1
    jump_late = fn(20, lv25_stat, **kwargs) - fn(14, lv25_stat, **kwargs)  # T2→T2+5 at Lv25
    base_early = fn(4, lv1_stat, **kwargs)
    base_late = fn(14, lv25_stat, **kwargs)

    # 3. 膨胀比：Lv25 T2+5 / Lv1 T0
    inflation = fn(20, lv25_stat, **kwargs) / fn(4, lv1_stat, **kwargs)

    # 4. 武器占比：weapon 贡献 vs 属性贡献
    weapon_only_early = fn(4, 0, **kwargs) if True else 4  # stat=0 时
    weapon_only_late = fn(20, 0, **kwargs) if True else 20
    # 有些公式 stat=0 会出问题，用 try
    try:
        weapon_share_early = fn(4, 0, **kwargs) / fn(4, lv1_stat, **kwargs)
    except:
        weapon_share_early = float('nan')
    try:
        weapon_share_late = fn(20, 0, **kwargs) / fn(20, lv25_stat, **kwargs)
    except:
        weapon_share_late = float('nan')

    return {
        "name": name,
        "curves": results,
        "jump_early": jump_early,
        "jump_early_pct": jump_early / base_early * 100,
        "jump_late": jump_late,
        "jump_late_pct": jump_late / base_late * 100,
        "inflation": inflation,
        "weapon_share_early": weapon_share_early,
        "weapon_share_late": weapon_share_late,
    }


# ── 跑所有方案 ──

formulas = [
    ("A: 纯乘法 w*(1+s*0.05)", formula_mult, {"k": 0.05}),
    ("B: 加法 w+s*0.5", formula_add, {"c": 0.5}),
    ("C: sqrt混合 w*(1+0.3√s)", formula_hybrid_sqrt, {"k": 0.3}),
    ("D: log混合 w*(1+0.5·ln(s))", formula_hybrid_log, {"k": 0.5}),
    ("E: 幂函数 w*(s/10)^0.5", formula_power, {"base_stat": 10, "p": 0.5}),
]

all_results = []
for name, fn, kwargs in formulas:
    r = analyze_formula(name, fn, **kwargs)
    all_results.append(r)


# ── 输出汇总表 ──

print("=" * 90)
print("攻击力导出公式对比")
print("=" * 90)
print(f"{'公式':<30} {'换武T0→T1':>10} {'%提升':>8} {'换武T2→T2+5':>12} {'%提升':>8} {'膨胀比':>8}")
print(f"{'':30} {'(Lv1)':>10} {'':>8} {'(Lv25)':>12} {'':>8} {'Lv25/Lv1':>8}")
print("-" * 90)
for r in all_results:
    print(f"{r['name']:<30} {r['jump_early']:>10.1f} {r['jump_early_pct']:>7.1f}% {r['jump_late']:>12.1f} {r['jump_late_pct']:>7.1f}% {r['inflation']:>8.1f}x")

print()
print(f"{'公式':<30} {'武器占比(Lv1)':>15} {'武器占比(Lv25)':>16}")
print("-" * 65)
for r in all_results:
    e = r['weapon_share_early']
    l = r['weapon_share_late']
    e_s = f"{e*100:.1f}%" if not math.isnan(e) else "N/A"
    l_s = f"{l*100:.1f}%" if not math.isnan(l) else "N/A"
    print(f"{r['name']:<30} {e_s:>15} {l_s:>16}")


# ── 详细数值表 ──

print()
print("=" * 90)
print("方案 C (sqrt混合) 详细数值 — 战士 STR 成长")
print("=" * 90)
r_c = all_results[2]  # sqrt
print(f"{'Level':>5} {'STR':>5}", end="")
for wname in WEAPONS:
    print(f" {wname:>14}", end="")
print()
for i, lv in enumerate(LEVELS):
    print(f"{lv:>5} {warrior_str(lv):>5}", end="")
    for wname in WEAPONS:
        print(f" {r_c['curves'][wname][i]:>14.1f}", end="")
    print()


# ═══════════════════════════════════════════
# 第二部分：破甲线公式
# ═══════════════════════════════════════════

print()
print("=" * 90)
print("破甲线公式对比 — 武器ATK vs 敌人PDEF → 伤害系数")
print("说明：假设 '破甲力' = weapon_atk, 在破甲线之后再乘属性乘数和技能系数")
print("=" * 90)

def armor_reduction_linear_clamp(weapon_atk, pdef, floor=0.1):
    """分段线性：已破甲=正常, 未破甲=线性衰减到 floor"""
    diff = weapon_atk - pdef
    if diff >= 0:
        return 1.0  # 已破甲，无减伤
    # 未破甲：从 1.0 线性衰减到 floor
    # 在 diff = -weapon_atk 时达到 floor（即 PDEF = 2*weapon_atk 时）
    ratio = max(floor, 1.0 + diff / weapon_atk * (1 - floor))
    return ratio

def armor_reduction_hyperbolic(weapon_atk, pdef, K=10, floor=0.1):
    """反比例衰减: 已破甲=正常, 未破甲=K/(K+|diff|) 但不低于 floor"""
    diff = weapon_atk - pdef
    if diff >= 0:
        return 1.0
    return max(floor, K / (K + abs(diff)))

def armor_reduction_exp(weapon_atk, pdef, K=12, floor=0.1):
    """指数衰减: 已破甲=正常, 未破甲=e^(-|diff|/K) 但不低于 floor"""
    diff = weapon_atk - pdef
    if diff >= 0:
        return 1.0
    return max(floor, math.exp(-abs(diff) / K))

def armor_reduction_smooth(weapon_atk, pdef, K=8, floor=0.1):
    """Sigmoid 平滑过渡（不是硬分段）:
    ratio = floor + (1-floor) * sigmoid((weapon_atk - pdef) / K)
    在 diff=0 时 ratio ≈ 0.55, diff>>0 时 → 1.0, diff<<0 时 → floor
    """
    diff = weapon_atk - pdef
    sig = 1 / (1 + math.exp(-diff / K))
    return floor + (1 - floor) * sig

# ── 测试场景 ──
# 固定 weapon_atk = 14 (铁剑), 扫描 PDEF 从 0 到 40

weapon_test = 14
pdef_range = list(range(0, 45))

armor_formulas = [
    ("线性衰减", armor_reduction_linear_clamp),
    ("反比例 K=10", lambda w, p: armor_reduction_hyperbolic(w, p, K=10)),
    ("指数 K=12", lambda w, p: armor_reduction_exp(w, p, K=12)),
    ("Sigmoid K=8", lambda w, p: armor_reduction_smooth(w, p, K=8)),
]

print(f"\n武器ATK = {weapon_test}, 扫描 PDEF 0~44")
print(f"{'PDEF':>6}", end="")
for name, _ in armor_formulas:
    print(f" {name:>14}", end="")
print(f" {'ATK-DEF':>8}")
print("-" * 80)
for pdef in pdef_range:
    print(f"{pdef:>6}", end="")
    for name, fn in armor_formulas:
        ratio = fn(weapon_test, pdef)
        print(f" {ratio:>13.1%}", end="")
    print(f" {weapon_test - pdef:>8}")


# ── 完整伤害计算示例 ──
# 使用方案 C (sqrt混合) + Sigmoid 破甲线

print()
print("=" * 90)
print("完整伤害示例：方案 C (sqrt) + Sigmoid 破甲线")
print("场景：战士 各等级 vs 各种 PDEF 怪物, 技能系数 1.0")
print("=" * 90)

def full_damage(weapon_atk, stat, pdef, skill_coeff=1.0, k_sqrt=0.3, armor_K=8, floor=0.1):
    """完整物理伤害计算"""
    # 1. 破甲判定（只用 weapon_atk vs PDEF）
    armor_ratio = armor_reduction_smooth(weapon_atk, pdef, K=armor_K, floor=floor)
    # 2. 属性乘数
    attr_mult = 1 + k_sqrt * math.sqrt(stat)
    # 3. 最终伤害 = weapon_atk * armor_ratio * attr_mult * skill_coeff
    return weapon_atk * armor_ratio * attr_mult * skill_coeff

# 场景表
scenarios = [
    # (描述, 等级, 武器名, 武器ATK, 怪物描述, 怪物PDEF)
    ("Lv1 训练剑 vs 史莱姆", 1, 4, 3),
    ("Lv1 训练剑 vs 骷髅", 1, 4, 15),
    ("Lv5 铜剑 vs 史莱姆", 5, 8, 3),
    ("Lv5 铜剑 vs 骷髅", 5, 8, 15),
    ("Lv10 铜剑+3 vs 暗影狼(PDEF10)", 10, 11, 10),
    ("Lv10 铜剑+3 vs 树人(PDEF22)", 10, 11, 22),
    ("Lv15 铁剑 vs 暗影狼(PDEF10)", 15, 14, 10),
    ("Lv15 铁剑 vs 树人(PDEF22)", 15, 14, 22),
    ("Lv15 铁剑 vs 石甲虫(PDEF35)", 15, 14, 35),
    ("Lv20 铁剑+3 vs 石甲虫(PDEF35)", 20, 17, 35),
    ("Lv25 铁剑+5 vs 石甲虫(PDEF35)", 25, 20, 35),
    ("Lv25 铁剑+5 vs Boss(PDEF40)", 25, 20, 40),
]

print(f"{'场景':<40} {'Lv':>3} {'wATK':>5} {'STR':>5} {'PDEF':>5} {'甲比':>8} {'属性乘':>8} {'伤害':>8}")
print("-" * 95)
for desc, lv, watk, pdef in scenarios:
    stat = warrior_str(lv)
    armor_r = armor_reduction_smooth(watk, pdef, K=8, floor=0.1)
    attr_m = 1 + 0.3 * math.sqrt(stat)
    dmg = full_damage(watk, stat, pdef)
    print(f"{desc:<40} {lv:>3} {watk:>5} {stat:>5} {pdef:>5} {armor_r:>7.1%} {attr_m:>8.2f} {dmg:>8.1f}")

# ── 多段攻击对比 ──
print()
print("=" * 90)
print("多段 vs 单段对比 — 巡林客连射(2×65%) vs 战士重击(1×150%)")
print("=" * 90)

def multi_hit_damage(weapon_atk, stat, pdef, hits, coeff_per_hit, k_sqrt=0.3, armor_K=8, floor=0.1):
    single = full_damage(weapon_atk, stat, pdef, skill_coeff=coeff_per_hit,
                         k_sqrt=k_sqrt, armor_K=armor_K, floor=floor)
    return single * hits

print(f"{'场景':<35} {'wATK':>5} {'PDEF':>5} {'战士重击':>10} {'巡林连射':>10} {'连射/重击':>10}")
print("-" * 80)
for pdef in [3, 10, 15, 22, 30, 35, 40]:
    watk = 14  # 铁剑
    stat = warrior_str(15)  # Lv15
    warrior_dmg = full_damage(watk, stat, pdef, skill_coeff=1.5)
    ranger_stat = ranger_dex(15)
    ranger_dmg = multi_hit_damage(watk, ranger_stat, pdef, hits=2, coeff_per_hit=0.65)
    ratio = ranger_dmg / warrior_dmg if warrior_dmg > 0 else 0
    print(f"Lv15 铁剑 vs PDEF={pdef:<3}            {watk:>5} {pdef:>5} {warrior_dmg:>10.1f} {ranger_dmg:>10.1f} {ratio:>9.1%}")


# ═══════════════════════════════════════════
# 第三部分：画图（如果 matplotlib 可用）
# ═══════════════════════════════════════════

if HAS_MPL:
    fig, axes = plt.subplots(2, 2, figsize=(14, 10))
    fig.suptitle("攻击力公式 & 破甲线探索", fontsize=14)

    # 图1：各公式的 PATK 随等级变化（固定 T2 铁剑 ATK=14）
    ax = axes[0][0]
    for r in all_results:
        ax.plot(LEVELS, r["curves"]["T2 铁剑"], label=r["name"])
    ax.set_xlabel("Level")
    ax.set_ylabel("PATK")
    ax.set_title("PATK vs Level (weapon=铁剑 ATK14)")
    ax.legend(fontsize=7)
    ax.grid(True, alpha=0.3)

    # 图2：换武器跳跃感 — 各等级下 T1→T2 的绝对跳跃
    ax = axes[0][1]
    for r in all_results:
        jumps = [r["curves"]["T2 铁剑"][i] - r["curves"]["T1 铜剑"][i] for i in range(len(LEVELS))]
        ax.plot(LEVELS, jumps, label=r["name"])
    ax.set_xlabel("Level")
    ax.set_ylabel("PATK 跳跃 (T1铜剑→T2铁剑)")
    ax.set_title("换武器跳跃感 vs Level")
    ax.legend(fontsize=7)
    ax.grid(True, alpha=0.3)

    # 图3：破甲线各方案
    ax = axes[1][0]
    for name, fn in armor_formulas:
        ratios = [fn(weapon_test, p) for p in pdef_range]
        ax.plot(pdef_range, ratios, label=name)
    ax.axvline(x=weapon_test, color='red', linestyle='--', alpha=0.5, label=f'weapon ATK={weapon_test}')
    ax.set_xlabel("Enemy PDEF")
    ax.set_ylabel("伤害系数 (1.0=无减伤)")
    ax.set_title(f"破甲线衰减对比 (weapon ATK={weapon_test})")
    ax.legend(fontsize=7)
    ax.grid(True, alpha=0.3)

    # 图4：完整伤害 — Lv15 战士 铁剑 vs 不同 PDEF
    ax = axes[1][1]
    pdefs = list(range(0, 50))
    for armor_name, armor_fn in armor_formulas:
        damages = []
        for p in pdefs:
            stat = warrior_str(15)
            ar = armor_fn(14, p)
            attr_m = 1 + 0.3 * math.sqrt(stat)
            dmg = 14 * ar * attr_m * 1.0
            damages.append(dmg)
        ax.plot(pdefs, damages, label=armor_name)
    ax.axvline(x=14, color='red', linestyle='--', alpha=0.5, label='weapon ATK=14')
    ax.set_xlabel("Enemy PDEF")
    ax.set_ylabel("伤害")
    ax.set_title("完整伤害: Lv15战士 铁剑(ATK14) vs PDEF")
    ax.legend(fontsize=7)
    ax.grid(True, alpha=0.3)

    plt.tight_layout()
    # 中文字体支持
    try:
        plt.rcParams['font.sans-serif'] = ['Microsoft YaHei', 'SimHei', 'sans-serif']
        plt.rcParams['axes.unicode_minus'] = False
    except:
        pass

    plot_path = os.path.join(OUTPUT_DIR, "atk_formula_explore.png")
    plt.savefig(plot_path, dpi=150)
    print(f"\n[PLOT] saved: {plot_path}")
else:
    print("\n[SKIP] no matplotlib. install: pip install matplotlib")

print("\n[DONE] explore script finished.")

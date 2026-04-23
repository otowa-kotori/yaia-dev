"""
破甲线衰减：绝对差值 vs 防御比例

核心问题：衰减是基于 |ATK - DEF|（绝对差值），还是 DEF/ATK（防御比例）？

按比例的好处：
  - 武器ATK=8 vs PDEF=16 的衰减程度 == 武器ATK=20 vs PDEF=40
  - "2倍防御就是一样难打"，不管绝对值多少
  - 装备升级后，面对同比例防御的怪物，体验一致

按绝对值的好处：
  - 简单直觉
  - 但 ATK=8 vs PDEF=16（差8）比 ATK=20 vs PDEF=28（差8）衰减一样
    → 高级怪物和低级怪物的"打不动"感觉一样，不太合理

用法: python scripts/armor_ratio_explore.py
"""

import math
import os

try:
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    plt.rcParams['font.sans-serif'] = ['Microsoft YaHei', 'SimHei', 'sans-serif']
    plt.rcParams['axes.unicode_minus'] = False
    HAS_MPL = True
except ImportError:
    HAS_MPL = False

OUTPUT_DIR = os.path.join(os.path.dirname(__file__), "..", "docs", "design", "plots")
os.makedirs(OUTPUT_DIR, exist_ok=True)


# === 衰减函数定义 ===

# -- 基于绝对差值 --

def decay_abs_hyperbolic(weapon_atk, pdef, K=10, floor=0.1):
    """反比例，绝对差值: K / (K + |diff|)"""
    diff = weapon_atk - pdef
    if diff >= 0:
        return 1.0
    return max(floor, K / (K + abs(diff)))

def decay_abs_exp(weapon_atk, pdef, K=12, floor=0.1):
    """指数，绝对差值: e^(-|diff|/K)"""
    diff = weapon_atk - pdef
    if diff >= 0:
        return 1.0
    return max(floor, math.exp(-abs(diff) / K))

# -- 基于防御比例 --

def decay_ratio_hyperbolic(weapon_atk, pdef, K=1.0, floor=0.1):
    """反比例，按比例: K / (K + max(0, pdef/atk - 1))
    当 pdef <= atk 时 ratio=0 → 系数=1.0（已破甲）
    当 pdef = 2*atk 时 ratio=1 → 系数 = K/(K+1)
    """
    if weapon_atk <= 0:
        return floor
    if pdef <= weapon_atk:
        return 1.0
    excess_ratio = pdef / weapon_atk - 1  # 超出破甲线的比例 (0=刚好, 1=2倍防御)
    return max(floor, K / (K + excess_ratio))

def decay_ratio_exp(weapon_atk, pdef, K=1.0, floor=0.1):
    """指数，按比例: e^(-excess_ratio/K)"""
    if weapon_atk <= 0:
        return floor
    if pdef <= weapon_atk:
        return 1.0
    excess_ratio = pdef / weapon_atk - 1
    return max(floor, math.exp(-excess_ratio / K))

def decay_ratio_power(weapon_atk, pdef, K=1.0, p=1.5, floor=0.1):
    """带幂的反比例，按比例: K / (K + excess_ratio^p)
    p>1 让大比例时衰减更快
    """
    if weapon_atk <= 0:
        return floor
    if pdef <= weapon_atk:
        return 1.0
    excess_ratio = pdef / weapon_atk - 1
    return max(floor, K / (K + excess_ratio ** p))


# === 实验 1：固定武器ATK，扫描PDEF ===

print("=" * 100)
print("实验 1：固定武器ATK=14（铁剑），扫描 PDEF 0~50")
print("对比绝对差值 vs 防御比例")
print("=" * 100)

weapon = 14
pdefs = list(range(0, 51))

funcs = [
    ("abs-hyper K=10",    lambda w, p: decay_abs_hyperbolic(w, p, K=10)),
    ("abs-exp K=12",      lambda w, p: decay_abs_exp(w, p, K=12)),
    ("ratio-hyper K=0.8", lambda w, p: decay_ratio_hyperbolic(w, p, K=0.8)),
    ("ratio-exp K=0.8",   lambda w, p: decay_ratio_exp(w, p, K=0.8)),
    ("ratio-pow K=0.8 p=1.5", lambda w, p: decay_ratio_power(w, p, K=0.8, p=1.5)),
]

header = f"{'PDEF':>5} {'PDEF/ATK':>9}"
for name, _ in funcs:
    header += f" {name:>20}"
print(header)
print("-" * len(header))

for pdef in pdefs:
    ratio_str = f"{pdef/weapon:.2f}" if weapon > 0 else "N/A"
    line = f"{pdef:>5} {ratio_str:>9}"
    for name, fn in funcs:
        coeff = fn(weapon, pdef)
        line += f" {coeff:>19.1%}"
    print(line)


# === 实验 2：不同武器ATK，相同PDEF/ATK比例 ===

print()
print("=" * 100)
print("实验 2：验证'按比例衰减'的缩放一致性")
print("同一个 PDEF/ATK 比例下，不同武器等级的衰减系数应该相同")
print("=" * 100)

test_ratios = [0.5, 1.0, 1.5, 2.0, 2.5, 3.0]
test_weapons = [4, 8, 14, 20]  # T0, T1, T2, T2+5

print(f"\n{'PDEF/ATK比':>10}", end="")
for w in test_weapons:
    print(f"  ATK={w:>2}(abs-h)", end="")
    print(f"  ATK={w:>2}(rat-h)", end="")
print()
print("-" * 120)

for ratio in test_ratios:
    print(f"{ratio:>10.1f}", end="")
    for w in test_weapons:
        pdef = int(w * ratio)
        abs_c = decay_abs_hyperbolic(w, pdef, K=10)
        rat_c = decay_ratio_hyperbolic(w, pdef, K=0.8)
        print(f"  {abs_c:>14.1%}", end="")
        print(f"  {rat_c:>14.1%}", end="")
    print()


# === 实验 3：比例衰减的 K 值敏感性 ===

print()
print("=" * 100)
print("实验 3：ratio-hyperbolic 的 K 值敏感性 (weapon ATK=14)")
print("K 越大 → 衰减越慢（更温和）; K 越小 → 衰减越快（更严厉）")
print("=" * 100)

K_values = [0.4, 0.6, 0.8, 1.0, 1.5, 2.0]

header = f"{'PDEF':>5} {'ratio':>6}"
for k in K_values:
    header += f" {'K='+str(k):>10}"
print(header)
print("-" * len(header))

for pdef in range(0, 51, 2):
    r = pdef / weapon
    line = f"{pdef:>5} {r:>6.2f}"
    for k in K_values:
        c = decay_ratio_hyperbolic(weapon, pdef, K=k)
        line += f" {c:>9.1%}"
    print(line)


# === 实验 4：完整伤害链条 ===

print()
print("=" * 100)
print("实验 4：完整伤害链 (ratio-hyperbolic K=0.8)")
print("面板PATK = wATK * (1 + 0.3 * sqrt(stat))")
print("最终伤害 = wATK * 破甲系数(wATK, PDEF) * 属性乘数 * 技能系数")
print("注意：破甲系数只看 wATK vs PDEF，不看面板PATK")
print("=" * 100)

def warrior_str(lv):
    return 10 + (lv - 1) * 2

def panel_patk(watk, stat, k=0.3, p=0.5):
    return watk * (1 + k * stat ** p)

def final_damage(watk, stat, pdef, skill_coeff=1.0, k=0.3, p=0.5, armor_K=0.8, floor=0.1):
    armor_coeff = decay_ratio_hyperbolic(watk, pdef, K=armor_K, floor=floor)
    attr_mult = 1 + k * stat ** p
    return watk * armor_coeff * attr_mult * skill_coeff

scenarios = [
    # (desc, lv, watk, pdef, skill_coeff)
    ("Lv1 T0(4) vs PDEF=3 (slime)",          1,  4,  3, 1.0),
    ("Lv1 T0(4) vs PDEF=8 (hard)",           1,  4,  8, 1.0),
    ("Lv5 T1(8) vs PDEF=3 (slime)",          5,  8,  3, 1.0),
    ("Lv5 T1(8) vs PDEF=8",                  5,  8,  8, 1.0),
    ("Lv5 T1(8) vs PDEF=15",                 5,  8, 15, 1.0),
    ("Lv10 T1+3(11) vs PDEF=10",            10, 11, 10, 1.0),
    ("Lv10 T1+3(11) vs PDEF=22 (tree)",     10, 11, 22, 1.0),
    ("Lv15 T2(14) vs PDEF=10",              15, 14, 10, 1.0),
    ("Lv15 T2(14) vs PDEF=22",              15, 14, 22, 1.0),
    ("Lv15 T2(14) vs PDEF=35 (beetle)",     15, 14, 35, 1.0),
    ("Lv20 T2+3(17) vs PDEF=35",            20, 17, 35, 1.0),
    ("Lv25 T2+5(20) vs PDEF=35",            25, 20, 35, 1.0),
    ("Lv25 T2+5(20) vs PDEF=40 (boss)",     25, 20, 40, 1.0),
    ("--- Skill 1.5x ---",                    0,  0,  0, 0.0),
    ("Lv15 T2(14) vs PDEF=35 x1.5",         15, 14, 35, 1.5),
    ("Lv25 T2+5(20) vs PDEF=40 x1.5",       25, 20, 40, 1.5),
    ("--- Multi-hit 2x0.65 ---",              0,  0,  0, 0.0),
    ("Lv15 T2(14) vs PDEF=10 2x0.65",       15, 14, 10, 0.65),
    ("Lv15 T2(14) vs PDEF=35 2x0.65",       15, 14, 35, 0.65),
]

print(f"{'scene':<42} {'Lv':>3} {'wATK':>5} {'stat':>5} {'PDEF':>5} {'panel':>7} {'armor%':>7} {'dmg':>7} {'x2hit':>7}")
print("-" * 105)
for desc, lv, watk, pdef, sc in scenarios:
    if watk == 0:
        print(f"{desc}")
        continue
    stat = warrior_str(lv)
    panel = panel_patk(watk, stat)
    armor = decay_ratio_hyperbolic(watk, pdef, K=0.8)
    dmg = final_damage(watk, stat, pdef, skill_coeff=sc)
    x2 = final_damage(watk, stat, pdef, skill_coeff=sc) * 2 if "2x" in desc else 0
    x2_s = f"{x2:.1f}" if x2 > 0 else ""
    print(f"{desc:<42} {lv:>3} {watk:>5} {stat:>5} {pdef:>5} {panel:>7.1f} {armor:>6.0%} {dmg:>7.1f} {x2_s:>7}")


# === 画图 ===

if HAS_MPL:
    fig, axes = plt.subplots(2, 2, figsize=(14, 10))
    fig.suptitle("Armor Decay: Absolute vs Ratio-based", fontsize=14)

    # 1: weapon ATK=14, compare all
    ax = axes[0][0]
    for name, fn in funcs:
        vals = [fn(weapon, p) for p in pdefs]
        ax.plot(pdefs, vals, label=name)
    ax.axvline(x=weapon, color='red', ls='--', alpha=0.5, label=f'ATK={weapon}')
    ax.set_xlabel("Enemy PDEF")
    ax.set_ylabel("Damage coefficient")
    ax.set_title(f"All formulas, weapon ATK={weapon}")
    ax.legend(fontsize=7)
    ax.grid(True, alpha=0.3)

    # 2: ratio-hyperbolic scaling consistency
    ax = axes[0][1]
    for w in test_weapons:
        pdef_range = list(range(0, w * 4))
        ratios_x = [p / w for p in pdef_range]
        vals = [decay_ratio_hyperbolic(w, p, K=0.8) for p in pdef_range]
        ax.plot(ratios_x, vals, label=f"ATK={w}")
    ax.set_xlabel("PDEF / weapon ATK")
    ax.set_ylabel("Damage coefficient")
    ax.set_title("ratio-hyperbolic K=0.8: scaling consistency")
    ax.legend()
    ax.grid(True, alpha=0.3)

    # 3: K sensitivity
    ax = axes[1][0]
    for k in K_values:
        vals = [decay_ratio_hyperbolic(weapon, p, K=k) for p in pdefs]
        ax.plot(pdefs, vals, label=f"K={k}")
    ax.axvline(x=weapon, color='red', ls='--', alpha=0.5)
    ax.set_xlabel("Enemy PDEF")
    ax.set_ylabel("Damage coefficient")
    ax.set_title(f"ratio-hyperbolic K sensitivity (ATK={weapon})")
    ax.legend()
    ax.grid(True, alpha=0.3)

    # 4: ratio-power with different p
    ax = axes[1][1]
    p_values = [1.0, 1.5, 2.0, 2.5]
    for pp in p_values:
        vals = [decay_ratio_power(weapon, pdef_v, K=0.8, p=pp) for pdef_v in pdefs]
        ax.plot(pdefs, vals, label=f"p={pp}")
    ax.axvline(x=weapon, color='red', ls='--', alpha=0.5)
    ax.set_xlabel("Enemy PDEF")
    ax.set_ylabel("Damage coefficient")
    ax.set_title(f"ratio-power K=0.8 (ATK={weapon}): p sensitivity")
    ax.legend()
    ax.grid(True, alpha=0.3)

    plt.tight_layout()
    path = os.path.join(OUTPUT_DIR, "armor_ratio_explore.png")
    plt.savefig(path, dpi=150)
    print(f"\n[PLOT] saved: {path}")

print("\n[DONE]")

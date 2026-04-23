"""
XP 曲线探索 — 从心流时间锚点反推 Idleon 式公式参数

方法：
1. 定义心流阶段的时间→等级锚点
2. 估算每个等级段的 kill/min 和怪物 XP
3. 计算每个等级段的"可获得 XP/min"
4. 从目标时间反推每级需要多少 XP
5. 用 Idleon 公式拟合
6. 画图验证

用法: python scripts/xp_curve_explore.py
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

# ═══════════════════════════════════════════
# 1. 心流时间锚点（主角战士，纯挂机时间）
# ═══════════════════════════════════════════

# (目标等级, 累计纯挂机分钟数)
# 注意这是战斗挂机时间，不含采集/合成/操作时间
# Day1: ~2h操作 + ~14h挂机(其中约10h战斗挂机，4h采集)
# Day2: ~2h操作 + ~14h挂机
# Day3-5: ~0.5h操作 + ~16h挂机/天

FLOW_ANCHORS = [
    # (level, cumulative_combat_minutes, description)
    (3,    5,       "Stage 0: first few fights"),
    (5,    15,      "Stage 1: early"),
    (8,    60,      "Stage 1 end: got copper gear"),
    (10,   120,     "Stage 2: early idle"),
    (12,   240,     "Stage 2: mid (4h挂机)"),
    (14,   480,     "Stage 2 end: Day1末 (8h挂机)"),
    (16,   720,     "Stage 3: early Day2 (12h)"),
    (18,   1080,    "Stage 3: mid Day2 (18h)"),
    (20,   1500,    "Stage 3 end: Day2末 (25h)"),
    (22,   2100,    "Stage 4: Day3 (35h)"),
    (24,   2700,    "Stage 4: mid Day4 (45h)"),
    (25,   3300,    "Stage 4 end: Day4 (55h)"),
    (27,   4000,    "Stage 5: late Day4 (67h)"),
    (28,   4500,    "Stage 5: Day5 boss ready (75h)"),
]

# ═══════════════════════════════════════════
# 2. 怪物 XP 和 kill rate 估算
# ═══════════════════════════════════════════

def monster_xp_for_level(monster_lv):
    """怪物给的 XP（打同级怪时）
    低级怪 ~10-15 XP，高级怪 ~100-150 XP
    用简单的多项式: xp = 5 + 2*lv + 0.15*lv^2
    """
    return 5 + 2 * monster_lv + 0.15 * monster_lv ** 2

def level_diff_penalty(player_lv, monster_lv):
    """等级差 XP 倍率"""
    diff = monster_lv - player_lv  # 正=怪物高级，负=怪物低级
    if diff >= 3:
        return 1.2
    elif diff >= 1:
        return 1.1
    elif diff >= 0:
        return 1.0
    elif diff >= -2:
        return 0.9
    elif diff >= -4:
        return 0.7
    elif diff >= -6:
        return 0.4
    else:
        return 0.1

def kills_per_minute(player_lv):
    """估算每分钟击杀数
    前期怪弱打得快 (~5/min)
    中期 (~3-4/min)
    后期怪强打得慢 (~2-3/min)
    """
    if player_lv <= 5:
        return 5
    elif player_lv <= 10:
        return 4
    elif player_lv <= 15:
        return 3.5
    elif player_lv <= 20:
        return 3
    elif player_lv <= 25:
        return 2.5
    else:
        return 2.5

def xp_per_minute(player_lv):
    """玩家在同级区域挂机每分钟获得的 XP"""
    monster_lv = player_lv  # 假设打同级怪
    xp_per_kill = monster_xp_for_level(monster_lv) * level_diff_penalty(player_lv, monster_lv)
    return xp_per_kill * kills_per_minute(player_lv)


# ═══════════════════════════════════════════
# 3. 从时间锚点反推每级 XP 需求
# ═══════════════════════════════════════════

def derive_xp_requirements():
    """从锚点反推：在两个锚点之间，玩家总共获得了多少 XP？
    然后平均分配到中间的每个等级。
    """
    xp_per_level = {}

    for i in range(len(FLOW_ANCHORS) - 1):
        lv_start, t_start, _ = FLOW_ANCHORS[i]
        lv_end, t_end, _ = FLOW_ANCHORS[i + 1]

        dt_minutes = t_end - t_start
        levels_to_gain = lv_end - lv_start

        # 计算这个时间段内玩家的平均 XP 收入
        mid_level = (lv_start + lv_end) / 2
        avg_xpm = xp_per_minute(mid_level)
        total_xp_earned = avg_xpm * dt_minutes

        # 平均分配到每级（简化，实际应该前低后高）
        # 但为了更自然，用简单递增：每级 XP = base * (1 + growth * i)
        # 先算均值
        xp_avg = total_xp_earned / levels_to_gain

        for lv in range(lv_start + 1, lv_end + 1):
            # 在区间内做简单递增
            position = (lv - lv_start) / levels_to_gain  # 0~1
            scale = 0.7 + 0.6 * position  # 从 0.7*avg 到 1.3*avg
            xp_per_level[lv] = xp_avg * scale

    return xp_per_level


# ═══════════════════════════════════════════
# 4. Idleon 式公式拟合
# ═══════════════════════════════════════════

def idleon_xp(lvl, a=10, p=1.8, c=8, base=1.18, cap=0.14, d=0.18, e=80, offset=10):
    """Idleon XP formula"""
    if lvl <= 1:
        return a
    part_a = a + lvl ** p + c * lvl
    brake = min(cap, d * lvl / (lvl + e))
    part_b = (base - brake) ** lvl
    return max(1, int(part_a * part_b - offset))


# 参数搜索：尝试几组参数看哪个最接近反推的需求

PARAM_SETS = {
    "A: p=1.8 base=1.18 cap=0.14": dict(a=10, p=1.8, c=8, base=1.18, cap=0.14, d=0.18, e=80, offset=10),
    "B: p=1.6 base=1.15 cap=0.12": dict(a=10, p=1.6, c=10, base=1.15, cap=0.12, d=0.15, e=60, offset=10),
    "C: p=1.7 base=1.12 cap=0.10": dict(a=10, p=1.7, c=12, base=1.12, cap=0.10, d=0.12, e=50, offset=10),
    "D: p=2.0 base=1.10 cap=0.08": dict(a=8, p=2.0, c=6, base=1.10, cap=0.08, d=0.10, e=50, offset=8),
    "E: p=1.9 base=1.08 cap=0.06": dict(a=8, p=1.9, c=10, base=1.08, cap=0.06, d=0.08, e=40, offset=8),
}


# ═══════════════════════════════════════════
# 5. 输出分析
# ═══════════════════════════════════════════

print("=" * 100)
print("Step 1: Monster XP and kill rate by level")
print("=" * 100)
print(f"{'Level':>5} {'MonsterXP':>10} {'Kill/min':>10} {'XP/min':>10}")
print("-" * 40)
for lv in range(1, 31):
    mxp = monster_xp_for_level(lv)
    kpm = kills_per_minute(lv)
    xpm = xp_per_minute(lv)
    print(f"{lv:>5} {mxp:>10.1f} {kpm:>10.1f} {xpm:>10.1f}")

print()
print("=" * 100)
print("Step 2: XP requirements derived from flow anchors")
print("=" * 100)

derived = derive_xp_requirements()
cumulative_derived = 0

print(f"{'Level':>5} {'XP needed':>12} {'Cumulative':>12} {'XP/min@lv':>10} {'Min to level':>14}")
print("-" * 60)
for lv in range(2, 30):
    if lv in derived:
        xp_need = derived[lv]
        cumulative_derived += xp_need
        xpm = xp_per_minute(lv)
        minutes = xp_need / xpm if xpm > 0 else 0
        print(f"{lv:>5} {xp_need:>12.0f} {cumulative_derived:>12.0f} {xpm:>10.1f} {minutes:>14.1f}")

print()
print("=" * 100)
print("Step 3: Idleon formula parameter sets vs derived requirements")
print("=" * 100)

levels = list(range(2, 30))

# 计算每个参数集和反推值的拟合度
for name, params in PARAM_SETS.items():
    total_err = 0
    count = 0
    for lv in levels:
        if lv in derived:
            formula_val = idleon_xp(lv, **params)
            target_val = derived[lv]
            if target_val > 0:
                err = abs(formula_val - target_val) / target_val
                total_err += err
                count += 1
    avg_err = total_err / count if count > 0 else 999
    print(f"{name:<45} avg relative error: {avg_err:.1%}")

# 详细对比最有希望的参数集
print()
print("=" * 100)
print("Step 4: Detailed comparison")
print("=" * 100)

header = f"{'Lv':>3} {'Target':>10}"
for name in PARAM_SETS:
    short = name.split(":")[0]
    header += f" {short:>12}"
print(header)
print("-" * len(header))

for lv in levels:
    if lv in derived:
        line = f"{lv:>3} {derived[lv]:>10.0f}"
        for name, params in PARAM_SETS.items():
            val = idleon_xp(lv, **params)
            line += f" {val:>12}"
        print(line)

# 累计 XP
print()
print("Cumulative XP:")
header = f"{'Lv':>3} {'Target':>10}"
for name in PARAM_SETS:
    short = name.split(":")[0]
    header += f" {short:>12}"
header += f" {'XP/min':>10} {'MinToLv(tgt)':>14}"
print(header)
print("-" * len(header))

cum_target = 0
cum_formulas = {name: 0 for name in PARAM_SETS}

for lv in range(2, 30):
    if lv in derived:
        cum_target += derived[lv]
        line = f"{lv:>3} {cum_target:>10.0f}"
        for name, params in PARAM_SETS.items():
            cum_formulas[name] += idleon_xp(lv, **params)
            line += f" {cum_formulas[name]:>12}"
        xpm = xp_per_minute(lv)
        mtl = derived[lv] / xpm if xpm > 0 else 0
        line += f" {xpm:>10.1f} {mtl:>14.1f}"
        print(line)


# 时间线验证
print()
print("=" * 100)
print("Step 5: Timeline verification (hours to reach each level)")
print("Using derived XP targets + XP/min")
print("=" * 100)

cum_minutes = 0
print(f"{'Lv':>3} {'XP need':>10} {'XP/min':>8} {'This lv':>10} {'Cumul hrs':>10} {'Flow target':>12}")
print("-" * 65)

flow_dict = {lv: t for lv, t, _ in FLOW_ANCHORS}

for lv in range(2, 30):
    if lv in derived:
        xpm = xp_per_minute(lv)
        mins = derived[lv] / xpm
        cum_minutes += mins
        hours = cum_minutes / 60
        flow_target = flow_dict.get(lv, "")
        ft_str = f"{flow_target/60:.1f}h" if flow_target else ""
        print(f"{lv:>3} {derived[lv]:>10.0f} {xpm:>8.1f} {mins:>8.1f}m {hours:>10.1f}h {ft_str:>12}")


# ═══════════════════════════════════════════
# 6. 画图
# ═══════════════════════════════════════════

if HAS_MPL:
    fig, axes = plt.subplots(2, 2, figsize=(14, 10))
    fig.suptitle("XP Curve Exploration", fontsize=14)

    plot_levels = list(range(1, 35))

    # 1: Per-level XP (linear)
    ax = axes[0][0]
    # derived
    d_lvs = sorted(derived.keys())
    d_vals = [derived[l] for l in d_lvs]
    ax.plot(d_lvs, d_vals, 'ko-', label="Target (derived)", markersize=4)
    for name, params in PARAM_SETS.items():
        vals = [idleon_xp(l, **params) for l in plot_levels]
        short = name.split(":")[0]
        ax.plot(plot_levels, vals, label=short)
    ax.set_xlabel("Level")
    ax.set_ylabel("XP to level up")
    ax.set_title("Per-level XP requirement (linear)")
    ax.legend(fontsize=7)
    ax.grid(True, alpha=0.3)

    # 2: Per-level XP (log)
    ax = axes[0][1]
    ax.plot(d_lvs, d_vals, 'ko-', label="Target", markersize=4)
    for name, params in PARAM_SETS.items():
        vals = [idleon_xp(l, **params) for l in plot_levels]
        short = name.split(":")[0]
        ax.plot(plot_levels, vals, label=short)
    ax.set_yscale("log")
    ax.set_xlabel("Level")
    ax.set_ylabel("XP to level up (log)")
    ax.set_title("Per-level XP requirement (log scale)")
    ax.legend(fontsize=7)
    ax.grid(True, alpha=0.3)

    # 3: Cumulative XP
    ax = axes[1][0]
    cum = 0
    cum_d = []
    for l in d_lvs:
        cum += derived[l]
        cum_d.append(cum)
    ax.plot(d_lvs, cum_d, 'ko-', label="Target", markersize=4)
    for name, params in PARAM_SETS.items():
        c = 0
        cum_vals = []
        for l in plot_levels:
            c += idleon_xp(l, **params)
            cum_vals.append(c)
        short = name.split(":")[0]
        ax.plot(plot_levels, cum_vals, label=short)
    ax.set_xlabel("Level")
    ax.set_ylabel("Cumulative XP")
    ax.set_title("Cumulative XP (linear)")
    ax.legend(fontsize=7)
    ax.grid(True, alpha=0.3)

    # 4: Hours to reach level
    ax = axes[1][1]
    cum_min = 0
    hrs_d = []
    for l in d_lvs:
        xpm = xp_per_minute(l)
        cum_min += derived[l] / xpm
        hrs_d.append(cum_min / 60)
    ax.plot(d_lvs, hrs_d, 'ko-', label="Target", markersize=4)

    # flow anchors
    fa_lvs = [lv for lv, _, _ in FLOW_ANCHORS]
    fa_hrs = [t / 60 for _, t, _ in FLOW_ANCHORS]
    ax.plot(fa_lvs, fa_hrs, 'r*', markersize=12, label="Flow anchors", zorder=5)

    for name, params in PARAM_SETS.items():
        cm = 0
        hrs_f = []
        for l in plot_levels:
            xp_need = idleon_xp(l, **params)
            xpm = xp_per_minute(l)
            cm += xp_need / xpm
            hrs_f.append(cm / 60)
        short = name.split(":")[0]
        ax.plot(plot_levels, hrs_f, label=short)

    ax.set_xlabel("Level")
    ax.set_ylabel("Hours of combat")
    ax.set_title("Hours to reach level (vs flow anchors)")
    ax.legend(fontsize=7)
    ax.grid(True, alpha=0.3)

    plt.tight_layout()
    path = os.path.join(OUTPUT_DIR, "xp_curve_explore.png")
    plt.savefig(path, dpi=150)
    print(f"\n[PLOT] saved: {path}")

print("\n[DONE]")

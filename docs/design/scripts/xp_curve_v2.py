"""
XP 曲线 v2 — 从 "kills-to-level" 体验出发

思路转变：
  不从总时间反推 XP，而是从"每升一级需要打多少波怪"出发。
  然后验证总时间是否符合心流目标。

设计目标（体验感受）：
  Lv 1→2:  2-3 波（~1 min）—— "哇好快"
  Lv 5→6:  8-10 波（~3 min）—— "稳定成长"
  Lv 10→11: 20-25 波（~8 min）—— "开始需要挂一会了"
  Lv 15→16: 40-50 波（~15 min）—— "半小时挂机的节奏"
  Lv 20→21: 80-100 波（~30 min）—— "挂一个小时的节奏"
  Lv 25→26: 150-200 波（~1 hour）—— "几个小时才升一级"

这样的 kills-to-level 曲线大约是每 5 级翻 3-4 倍。

用法: python scripts/xp_curve_v2.py
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
# 1. 怪物 XP 和战斗节奏
# ═══════════════════════════════════════════

def monster_xp(lv):
    """同级怪物的 XP 奖励"""
    return 5 + 2 * lv + 0.15 * lv ** 2

def waves_per_minute(player_lv):
    """每分钟打多少波（一波 1-2 怪）"""
    if player_lv <= 5: return 4       # 15s/wave
    elif player_lv <= 10: return 3.5   # 17s/wave
    elif player_lv <= 15: return 3     # 20s/wave
    elif player_lv <= 20: return 2.5   # 24s/wave
    else: return 2.5                   # 24s/wave

def xp_per_wave(player_lv):
    """打同级怪一波获得的 XP (1-2 怪/波)"""
    monsters_per_wave = 1.3  # 平均 1.3 怪/波
    return monster_xp(player_lv) * monsters_per_wave

def level_diff_mult(player_lv, monster_lv):
    diff = monster_lv - player_lv
    if diff >= 3: return 1.2
    elif diff >= 1: return 1.1
    elif diff >= 0: return 1.0
    elif diff >= -2: return 0.9
    elif diff >= -4: return 0.7
    elif diff >= -6: return 0.4
    else: return 0.1


# ═══════════════════════════════════════════
# 2. kills-to-level 目标曲线
# ═══════════════════════════════════════════

# 目标：每升一级需要打的波数
# 这个曲线才是核心体验

def target_waves_to_level(lv):
    """目标 waves-to-level 曲线
    用简单的公式: waves = a * lv^p
    调参让 Lv2 ~3 waves, Lv10 ~25 waves, Lv25 ~180 waves
    """
    # a * lv^p: a=1.0, p=1.8 → lv2: 3.5, lv10: 63, lv25: 316 (太多)
    # a=0.8, p=1.6 → lv2: 2.4, lv10: 32, lv25: 135 (差不多)
    # a=0.6, p=1.7 → lv2: 1.9, lv10: 30, lv25: 150 (ok)
    return 0.7 * lv ** 1.65

def target_xp_to_level(lv):
    """从 waves-to-level 反推 XP 需求"""
    waves = target_waves_to_level(lv)
    xp_pw = xp_per_wave(lv)
    return waves * xp_pw


# ═══════════════════════════════════════════
# 3. Idleon 公式拟合
# ═══════════════════════════════════════════

def idleon_xp(lvl, a=10, p=1.8, c=8, base=1.18, cap=0.14, d=0.18, e=80, offset=10):
    if lvl <= 1:
        return a
    part_a = a + lvl ** p + c * lvl
    brake = min(cap, d * lvl / (lvl + e))
    part_b = (base - brake) ** lvl
    return max(1, int(part_a * part_b - offset))

# 简化公式：不用 Idleon 的完整模板，先用更简单的公式匹配
# XP(lv) = a * lv^p * base^lv
# 或者直接用 target 曲线本身作为公式

def simple_poly_exp(lvl, a=5, p=1.65, base=1.04):
    """简化公式: a * lv^p * base^lv"""
    if lvl <= 1:
        return a
    return max(1, int(a * lvl ** p * base ** lvl))

PARAM_SETS = {
    "target waves*xpPerWave": None,  # 直接用目标曲线
    "simple a=5 p=1.65 b=1.04": dict(a=5, p=1.65, base=1.04),
    "simple a=4 p=1.7 b=1.03": dict(a=4, p=1.7, base=1.03),
    "simple a=6 p=1.5 b=1.05": dict(a=6, p=1.5, base=1.05),
    "simple a=3 p=1.8 b=1.02": dict(a=3, p=1.8, base=1.02),
    "idleon a=5 p=1.7 c=5 b=1.06 cap=0.04": dict(a=5, p=1.7, c=5, base=1.06, cap=0.04, d=0.05, e=40, offset=5),
}


# ═══════════════════════════════════════════
# 4. 输出
# ═══════════════════════════════════════════

print("=" * 100)
print("Target: waves-to-level and XP-to-level")
print("=" * 100)
print(f"{'Lv':>3} {'Waves':>8} {'XP/wave':>8} {'XP need':>10} {'Minutes':>8} {'CumHours':>10}")
cum_min = 0
for lv in range(2, 31):
    waves = target_waves_to_level(lv)
    xpw = xp_per_wave(lv)
    xp = target_xp_to_level(lv)
    wpm = waves_per_minute(lv)
    mins = waves / wpm
    cum_min += mins
    print(f"{lv:>3} {waves:>8.1f} {xpw:>8.1f} {xp:>10.0f} {mins:>7.1f}m {cum_min/60:>9.1f}h")

print()
print("=" * 100)
print("Formula comparison vs target")
print("=" * 100)

levels = list(range(2, 31))

header = f"{'Lv':>3} {'Target':>10}"
for name in PARAM_SETS:
    short = name[:20]
    header += f" {short:>22}"
print(header)
print("-" * len(header))

for lv in levels:
    target = target_xp_to_level(lv)
    line = f"{lv:>3} {target:>10.0f}"
    for name, params in PARAM_SETS.items():
        if params is None:
            val = target
        elif "idleon" in name:
            val = idleon_xp(lv, **params)
        else:
            val = simple_poly_exp(lv, **params)
        line += f" {val:>22}"
    print(line)

# 时间验证
print()
print("=" * 100)
print("Timeline: hours to reach level (using each formula)")
print("=" * 100)

header = f"{'Lv':>3} {'Target':>8}"
for name in PARAM_SETS:
    short = name[:16]
    header += f" {short:>18}"
print(header)
print("-" * len(header))

cum_times = {name: 0 for name in PARAM_SETS}

for lv in levels:
    wpm = waves_per_minute(lv)
    xpw = xp_per_wave(lv)
    xpm = wpm * xpw  # XP per minute

    target_t = target_xp_to_level(lv) / xpm
    cum_times["target waves*xpPerWave"] = cum_times.get("target waves*xpPerWave", 0) + target_t

    line = f"{lv:>3} {cum_times['target waves*xpPerWave']/60:>7.1f}h"

    for name, params in PARAM_SETS.items():
        if params is None:
            continue
        if "idleon" in name:
            xp = idleon_xp(lv, **params)
        else:
            xp = simple_poly_exp(lv, **params)
        mins = xp / xpm
        cum_times[name] += mins
        line += f" {cum_times[name]/60:>17.1f}h"
    print(line)

# flow anchor 对比
print()
print("=" * 100)
print("Flow anchor check (target curve)")
print("=" * 100)

FLOW_ANCHORS = [
    (3,    "0.1h",  "Stage 0 end"),
    (5,    "0.3h",  "early Stage 1"),
    (8,    "1.0h",  "Stage 1 end"),
    (10,   "2.0h",  "Stage 2 early"),
    (14,   "8.0h",  "Day 1 end"),
    (18,   "18h",   "Day 2 mid"),
    (20,   "25h",   "Day 2 end"),
    (22,   "35h",   "Day 3"),
    (25,   "55h",   "Day 4"),
    (28,   "75h",   "Day 5 boss"),
]

cum = 0
for lv in range(2, 31):
    wpm = waves_per_minute(lv)
    xpw = xp_per_wave(lv)
    mins = target_xp_to_level(lv) / (wpm * xpw)
    cum += mins
    for anchor_lv, target_time, desc in FLOW_ANCHORS:
        if lv == anchor_lv:
            print(f"  Lv{lv:>2}: actual {cum/60:.1f}h vs target {target_time} ({desc})")


# ═══════════════════════════════════════════
# 5. 画图
# ═══════════════════════════════════════════

if HAS_MPL:
    fig, axes = plt.subplots(2, 2, figsize=(14, 10))
    fig.suptitle("XP Curve v2: waves-to-level approach", fontsize=14)

    plot_lvs = list(range(2, 35))

    # 1: waves to level
    ax = axes[0][0]
    waves = [target_waves_to_level(l) for l in plot_lvs]
    ax.plot(plot_lvs, waves, 'k-o', markersize=3)
    ax.set_xlabel("Level")
    ax.set_ylabel("Waves to level up")
    ax.set_title("Waves needed per level (target)")
    ax.grid(True, alpha=0.3)

    # 2: XP per level (log)
    ax = axes[0][1]
    target_xps = [target_xp_to_level(l) for l in plot_lvs]
    ax.plot(plot_lvs, target_xps, 'ko-', markersize=3, label="Target")
    for name, params in PARAM_SETS.items():
        if params is None: continue
        if "idleon" in name:
            vals = [idleon_xp(l, **params) for l in plot_lvs]
        else:
            vals = [simple_poly_exp(l, **params) for l in plot_lvs]
        short = name[:20]
        ax.plot(plot_lvs, vals, label=short)
    ax.set_yscale("log")
    ax.set_xlabel("Level")
    ax.set_ylabel("XP per level (log)")
    ax.set_title("XP per level: target vs formulas")
    ax.legend(fontsize=6)
    ax.grid(True, alpha=0.3)

    # 3: Minutes per level
    ax = axes[1][0]
    mins = [target_waves_to_level(l) / waves_per_minute(l) for l in plot_lvs]
    ax.plot(plot_lvs, mins, 'k-o', markersize=3)
    ax.set_xlabel("Level")
    ax.set_ylabel("Minutes per level")
    ax.set_title("Time to gain one level (target)")
    ax.grid(True, alpha=0.3)

    # 4: Cumulative hours + flow anchors
    ax = axes[1][1]
    cum = 0
    cum_hrs = []
    for l in plot_lvs:
        wpm = waves_per_minute(l)
        xpw = xp_per_wave(l)
        m = target_xp_to_level(l) / (wpm * xpw)
        cum += m
        cum_hrs.append(cum / 60)
    ax.plot(plot_lvs, cum_hrs, 'k-o', markersize=3, label="Target curve")

    fa_lvs = [lv for lv, _, _ in FLOW_ANCHORS]
    fa_hrs = [float(t.replace('h','')) for _, t, _ in FLOW_ANCHORS]
    ax.plot(fa_lvs, fa_hrs, 'r*', markersize=12, label="Flow anchors", zorder=5)

    ax.set_xlabel("Level")
    ax.set_ylabel("Cumulative hours")
    ax.set_title("Hours to reach level (vs flow anchors)")
    ax.legend()
    ax.grid(True, alpha=0.3)

    plt.tight_layout()
    path = os.path.join(OUTPUT_DIR, "xp_curve_v2.png")
    plt.savefig(path, dpi=150)
    print(f"\n[PLOT] saved: {path}")

print("\n[DONE]")

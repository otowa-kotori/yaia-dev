"""
XP 曲线 v3 — 平缓怪物 XP (10→85) + Idleon 式升级曲线

参考 Idleon W1: 正式怪物 XP 从 10(Frog) 到 75(Wode Board)，约 7.5 倍。
我们的 8 种怪物: 10→85, 约 8.5 倍，覆盖 Lv1-30。

用法: python scripts/xp_curve_v3.py
"""
import math, os

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
# 1. 怪物定义 (平缓增长 10→85)
# ═══════════════════════════════════════════

MONSTERS = [
    # (name, unlock_level, xp_per_kill)
    ("Tutorial", 1,  3),   # 教学怪，裸手打几只就跳过
    ("M1",       2,  10),
    ("M2",       5,  18),
    ("M3",       8,  28),
    ("M4",       12, 40),
    ("M5",       16, 55),
    ("M6",       20, 70),
    ("M7",       24, 85),
]

def best_monster_xp(player_lv):
    """玩家能打的最高级怪物的 XP"""
    best_xp = 3
    for name, unlock, xp in MONSTERS:
        if player_lv >= unlock:
            best_xp = xp
    return best_xp

def kills_per_minute(player_lv):
    if player_lv <= 5: return 4
    elif player_lv <= 10: return 3.5
    elif player_lv <= 15: return 3
    elif player_lv <= 20: return 2.5
    else: return 2.5

# ═══════════════════════════════════════════
# 2. Idleon 升级公式
# ═══════════════════════════════════════════

def idleon_xp(lvl, a=10, p=1.8, c=8, base=1.18, cap=0.14, d=0.18, e=80, offset=10):
    if lvl <= 1: return a
    part_a = a + lvl ** p + c * lvl
    brake = min(cap, d * lvl / (lvl + e))
    part_b = (base - brake) ** lvl
    return max(1, int(part_a * part_b - offset))

# 参数集——覆盖从温和到陡峭
PARAM_SETS = {
    "A: p1.8 b1.18 cap.14": dict(a=10, p=1.8, c=8, base=1.18, cap=0.14, d=0.18, e=80, offset=10),
    "B: p1.9 b1.15 cap.12": dict(a=12, p=1.9, c=6, base=1.15, cap=0.12, d=0.15, e=60, offset=10),
    "C: p2.0 b1.12 cap.10": dict(a=10, p=2.0, c=5, base=1.12, cap=0.10, d=0.12, e=50, offset=8),
    "D: p1.7 b1.20 cap.15": dict(a=8,  p=1.7, c=10, base=1.20, cap=0.15, d=0.20, e=80, offset=8),
    "E: p1.8 b1.22 cap.16": dict(a=8,  p=1.8, c=8, base=1.22, cap=0.16, d=0.20, e=80, offset=8),
}

# ═══════════════════════════════════════════
# 3. 模拟
# ═══════════════════════════════════════════

print("=" * 80)
print("Monster XP income by player level")
print("=" * 80)
print(f"{'Lv':>3} {'Monster':>8} {'XP/kill':>8} {'Kill/min':>9} {'XP/min':>8}")
print("-" * 42)
for lv in range(1, 31):
    xpk = best_monster_xp(lv)
    kpm = kills_per_minute(lv)
    mn = [n for n, u, x in MONSTERS if lv >= u][-1]
    print(f"{lv:>3} {mn:>8} {xpk:>8} {kpm:>9.1f} {xpk*kpm:>8.1f}")

# 时间线模拟
FLOW_TARGETS = {3: "~5min", 5: "~15min", 8: "~1h", 10: "~2h", 14: "~8h",
                18: "~18h", 20: "~25h", 25: "~55h", 28: "~75h"}

for pname, params in PARAM_SETS.items():
    print()
    print("=" * 105)
    print(f"  {pname}")
    print("=" * 105)
    print(f"{'Lv':>3} {'XP need':>10} {'Mon XP':>7} {'Kill/m':>7} {'Kills':>8} {'Min/lv':>9} {'CumHrs':>8} {'Flow?':>10}")
    print("-" * 75)
    cum_min = 0
    for lv in range(2, 31):
        xp_need = idleon_xp(lv, **params)
        mxp = best_monster_xp(lv)
        kpm = kills_per_minute(lv)
        kills = xp_need / mxp
        mins = kills / kpm
        cum_min += mins
        flow = FLOW_TARGETS.get(lv, "")
        print(f"{lv:>3} {xp_need:>10,} {mxp:>7} {kpm:>7.1f} {kills:>8.0f} {mins:>8.1f}m {cum_min/60:>7.1f}h {flow:>10}")

# 汇总表
print()
print("=" * 105)
print("Summary: cumulative hours to reach level (all param sets)")
print("=" * 105)

header = f"{'Lv':>3} {'Target':>8}"
for pn in PARAM_SETS:
    header += f" {pn[:20]:>22}"
print(header)
print("-" * len(header))

for target_lv in [3, 5, 8, 10, 14, 18, 20, 22, 25, 28, 30]:
    ft = FLOW_TARGETS.get(target_lv, "")
    line = f"{target_lv:>3} {ft:>8}"
    for pname, params in PARAM_SETS.items():
        cum = 0
        for lv in range(2, target_lv + 1):
            xp_need = idleon_xp(lv, **params)
            mxp = best_monster_xp(lv)
            kpm = kills_per_minute(lv)
            cum += xp_need / mxp / kpm
        line += f" {cum/60:>21.1f}h"
    print(line)

# ═══════════════════════════════════════════
# 4. 画图
# ═══════════════════════════════════════════

if HAS_MPL:
    fig, axes = plt.subplots(2, 2, figsize=(14, 10))
    fig.suptitle("XP v3: flat monster XP (10-85) + Idleon formula", fontsize=14)
    plot_lvs = list(range(2, 31))

    # 1: XP per level (log)
    ax = axes[0][0]
    for pn, pa in PARAM_SETS.items():
        ax.plot(plot_lvs, [idleon_xp(l, **pa) for l in plot_lvs], label=pn[:20])
    ax.set_yscale("log")
    ax.set_xlabel("Level"); ax.set_ylabel("XP per level (log)")
    ax.set_title("Level-up XP requirement")
    ax.legend(fontsize=6); ax.grid(True, alpha=0.3)

    # 2: Kills to level
    ax = axes[0][1]
    for pn, pa in PARAM_SETS.items():
        ktl = [idleon_xp(l, **pa) / best_monster_xp(l) for l in plot_lvs]
        ax.plot(plot_lvs, ktl, label=pn[:20])
    ax.set_xlabel("Level"); ax.set_ylabel("Kills to level up")
    ax.set_title("Kills-to-level (best available monster)")
    ax.legend(fontsize=6); ax.grid(True, alpha=0.3)

    # 3: Minutes per level
    ax = axes[1][0]
    for pn, pa in PARAM_SETS.items():
        mpl = [idleon_xp(l, **pa) / best_monster_xp(l) / kills_per_minute(l) for l in plot_lvs]
        ax.plot(plot_lvs, mpl, label=pn[:20])
    ax.set_xlabel("Level"); ax.set_ylabel("Minutes per level")
    ax.set_title("Time per level (minutes)")
    ax.legend(fontsize=6); ax.grid(True, alpha=0.3)

    # 4: Cumulative hours + flow anchors
    ax = axes[1][1]
    for pn, pa in PARAM_SETS.items():
        cum = 0; hrs = []
        for l in plot_lvs:
            cum += idleon_xp(l, **pa) / best_monster_xp(l) / kills_per_minute(l)
            hrs.append(cum / 60)
        ax.plot(plot_lvs, hrs, label=pn[:20])

    fa_lvs = list(FLOW_TARGETS.keys())
    fa_hrs_map = {"~5min": 5/60, "~15min": 0.25, "~1h": 1, "~2h": 2, "~8h": 8,
                  "~18h": 18, "~25h": 25, "~55h": 55, "~75h": 75}
    fa_hrs = [fa_hrs_map[FLOW_TARGETS[l]] for l in fa_lvs]
    ax.plot(fa_lvs, fa_hrs, 'r*', markersize=12, label="Flow anchors", zorder=5)

    ax.set_xlabel("Level"); ax.set_ylabel("Cumulative hours")
    ax.set_title("Hours to reach level (vs flow anchors)")
    ax.legend(fontsize=6); ax.grid(True, alpha=0.3)

    plt.tight_layout()
    path = os.path.join(OUTPUT_DIR, "xp_curve_v3.png")
    plt.savefig(path, dpi=150)
    print(f"\n[PLOT] saved: {path}")

print("\n[DONE]")

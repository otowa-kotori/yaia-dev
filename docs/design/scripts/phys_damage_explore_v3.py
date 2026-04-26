"""
物理伤害公式探索 v3

核心改动：
1. 横轴改为 ATK / PDEF，更贴近“玩家堆攻击”的过程；
2. 主图看 damage / PDEF（等价于固定 PDEF 下的绝对伤害趋势）；
3. 额外画数值导数，直接检查是否存在明显折点；
4. 增加平滑候选：在 x=ATK/PDEF=1 附近做 C1 过渡，而不是硬拼接。

输出：
- docs/design/plots/phys_damage_progression_view.png
- docs/design/plots/phys_damage_progression_derivative.png

运行：
  python docs/design/scripts/phys_damage_explore_v3.py
"""

from __future__ import annotations

import math
import os
from dataclasses import dataclass
from typing import Callable

try:
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    plt.rcParams["font.sans-serif"] = ["Microsoft YaHei", "SimHei", "sans-serif"]
    plt.rcParams["axes.unicode_minus"] = False
    HAS_MPL = True
except ImportError:
    HAS_MPL = False

SCRIPT_DIR = os.path.dirname(__file__)
OUTPUT_DIR = os.path.normpath(os.path.join(SCRIPT_DIR, "..", "plots"))
os.makedirs(OUTPUT_DIR, exist_ok=True)


@dataclass(frozen=True)
class Curve:
    name: str
    fn: Callable[[float], float]  # x = ATK / PDEF -> y = damage / PDEF


def clamp01(v: float) -> float:
    return 0.0 if v <= 0 else 1.0 if v >= 1 else v


def smoothstep(edge0: float, edge1: float, x: float) -> float:
    if edge1 <= edge0:
        raise ValueError("edge1 must be > edge0")
    t = clamp01((x - edge0) / (edge1 - edge0))
    return t * t * (3 - 2 * t)


def derivative(fn: Callable[[float], float], x: float, *, h: float = 1e-4) -> float:
    return (fn(x + h) - fn(x - h)) / (2 * h)


def current_ratio_power_in_progression_view(
    x: float,
    *,
    K: float = 0.8,
    p: float = 1.5,
    floor_ratio: float = 0.1,
) -> float:
    """
    当前公式，换成 x = ATK / PDEF 视角，并输出 damage / PDEF。

    当 x >= 1（已破甲）时，damage = ATK，因此 y = damage/PDEF = x。
    """
    if x <= 0:
        return 0.0
    if x >= 1.0:
        return x
    excess = 1.0 / x - 1.0
    coeff = max(floor_ratio, K / (K + excess**p))
    return x * coeff


def subtractive_plain(x: float) -> float:
    """经典减法在 progression view 下：damage/PDEF = max(0, x - 1)."""
    return max(0.0, x - 1.0)


def c1_power_then_line(
    x: float,
    *,
    threshold_value: float = 0.25,
    pre_power: float = 4.0,
    lift_decay: float = 6.0,
) -> float:
    """
    平滑候选 A：
    - x <= 1：y = t * x^a
    - x >= 1：y = (x - 1) + t * exp(-k * (x - 1)^2)

    性质：
    - y(1) = t
    - 当 a = 1/t 时，左右导数在 x=1 都等于 1，严格 C1
    - x 很大时，渐近回到减法直线 y = x - 1

    这里默认 t=0.25, a=4，正好满足 a=1/t。
    """
    if x <= 0:
        return 0.0
    t = threshold_value
    if x <= 1.0:
        return t * (x**pre_power)
    return (x - 1.0) + t * math.exp(-lift_decay * (x - 1.0) ** 2)


def smooth_blend_power_to_line(
    x: float,
    *,
    threshold_value: float = 0.25,
    pre_power: float = 3.0,
    blend_half_width: float = 0.30,
) -> float:
    """
    平滑候选 B：
    - pre:  t * x^a                （破甲前缓慢增长，临近阈值时加速）
    - post: (x - 1) + t            （破甲后近似线性，上来就有 20~25% 伤害）
    - 用 smoothstep 在 [1-d, 1+d] 内平滑混合，保证 C1

    这个版本更像“阈值处已经明显抬起来”，但代价是远离阈值后会比纯减法更宽松。
    """
    if x <= 0:
        return 0.0
    t = threshold_value
    pre = t * (x**pre_power)
    post = (x - 1.0) + t
    d = blend_half_width
    s = smoothstep(1.0 - d, 1.0 + d, x)
    return (1.0 - s) * pre + s * post


def c1_power_with_slope_bump(
    x: float,
    *,
    threshold_value: float = 0.25,
    slope_bump: float = 0.35,
    bump_decay: float = 6.0,
) -> float:
    """
    平滑候选 C：更贴近“临界附近导数先抬高，再回到线性”。

    设 x = ATK / PDEF, y = damage / PDEF。

    - x <= 1: y = t * x^a
    - x > 1:  y = (x - 1) + [t + b * (x - 1)] * exp(-k * (x - 1)^2)

    其中：
    - t = y(1) = 阈值命中伤害（如 20%~25%）
    - b = 阈值处额外导数抬升量
    - k = 这个抬升衰减得多快

    当 a = (1 + b) / t 时：
    - 左右导数在 x=1 相等，整条曲线严格 C1；
    - x=1 附近导数 = 1 + b > 1，表现为“刚过破甲线伤害增长更快”；
    - x 很大时重新逼近减法直线 y = x - 1。
    """
    if x <= 0:
        return 0.0
    t = threshold_value
    b = slope_bump
    k = bump_decay
    pre_power = (1.0 + b) / t
    if x <= 1.0:
        return t * (x**pre_power)
    dx = x - 1.0
    return dx + (t + b * dx) * math.exp(-k * dx * dx)



def make_anchor_table(curves: list[Curve], xs: list[float]) -> None:
    print("=" * 140)
    print("锚点表：x = ATK / PDEF, y = damage / PDEF")
    print("固定怪物 PDEF 后，绝对伤害 = y * PDEF")
    print("=" * 140)
    header = f"{'x=ATK/PDEF':>10}"
    for curve in curves:
        header += f" {curve.name:>30}"
    print(header)
    print("-" * len(header))

    for x in xs:
        line = f"{x:>10.2f}"
        for curve in curves:
            y = curve.fn(x)
            line += f" {y:>10.3f} (dmg/ATK={y / x:>6.1%})"
        print(line)


def make_derivative_table(curves: list[Curve], xs: list[float]) -> None:
    print()
    print("=" * 140)
    print("导数表：d(damage/PDEF) / d(ATK/PDEF)")
    print("用来观察阈值附近是否有明显折点")
    print("=" * 140)
    header = f"{'x':>8}"
    for curve in curves:
        header += f" {curve.name:>20}"
    print(header)
    print("-" * len(header))

    for x in xs:
        line = f"{x:>8.2f}"
        for curve in curves:
            line += f" {derivative(curve.fn, x):>20.3f}"
        print(line)


def make_plots(curves: list[Curve]) -> None:
    if not HAS_MPL:
        print("[WARN] matplotlib 未安装，跳过作图。")
        return

    xs = [i / 100 for i in range(5, 401)]

    fig, axes = plt.subplots(1, 2, figsize=(15, 6))
    fig.suptitle("物理伤害 progression view：x=ATK/PDEF, y=damage/PDEF", fontsize=15)

    ax = axes[0]
    for curve in curves:
        ys = [curve.fn(x) for x in xs]
        ax.plot(xs, ys, linewidth=2, label=curve.name)
    ax.axvline(1.0, color="red", linestyle="--", alpha=0.5, label="ATK = PDEF")
    ax.set_title("伤害增长曲线")
    ax.set_xlabel("ATK / PDEF")
    ax.set_ylabel("damage / PDEF")
    ax.set_xlim(0, 4.0)
    ax.set_ylim(0, 3.2)
    ax.grid(True, alpha=0.3)
    ax.legend(fontsize=9)

    ax = axes[1]
    for curve in curves:
        ys = [derivative(curve.fn, x) for x in xs]
        ax.plot(xs, ys, linewidth=2, label=curve.name)
    ax.axvline(1.0, color="red", linestyle="--", alpha=0.5, label="ATK = PDEF")
    ax.set_title("导数曲线（看折点 / 加速区 / 线性区）")
    ax.set_xlabel("ATK / PDEF")
    ax.set_ylabel("d(damage/PDEF) / d(ATK/PDEF)")
    ax.set_xlim(0, 4.0)
    ax.set_ylim(-0.1, 2.5)
    ax.grid(True, alpha=0.3)
    ax.legend(fontsize=9)

    fig.tight_layout()
    path = os.path.join(OUTPUT_DIR, "phys_damage_progression_view.png")
    fig.savefig(path, dpi=160)
    print(f"[PLOT] saved: {path}")

    fig2, axes2 = plt.subplots(1, 2, figsize=(15, 6))
    fig2.suptitle("阈值附近放大图", fontsize=15)

    ax = axes2[0]
    for curve in curves:
        ys = [curve.fn(x) for x in xs if 0.6 <= x <= 1.6]
        sub_xs = [x for x in xs if 0.6 <= x <= 1.6]
        ax.plot(sub_xs, ys, linewidth=2, label=curve.name)
    ax.axvline(1.0, color="red", linestyle="--", alpha=0.5)
    ax.set_title("阈值附近伤害曲线")
    ax.set_xlabel("ATK / PDEF")
    ax.set_ylabel("damage / PDEF")
    ax.grid(True, alpha=0.3)
    ax.legend(fontsize=9)

    ax = axes2[1]
    for curve in curves:
        ys = [derivative(curve.fn, x) for x in xs if 0.6 <= x <= 1.6]
        sub_xs = [x for x in xs if 0.6 <= x <= 1.6]
        ax.plot(sub_xs, ys, linewidth=2, label=curve.name)
    ax.axvline(1.0, color="red", linestyle="--", alpha=0.5)
    ax.set_title("阈值附近导数")
    ax.set_xlabel("ATK / PDEF")
    ax.set_ylabel("derivative")
    ax.grid(True, alpha=0.3)
    ax.legend(fontsize=9)

    fig2.tight_layout()
    path2 = os.path.join(OUTPUT_DIR, "phys_damage_progression_derivative.png")
    fig2.savefig(path2, dpi=160)
    print(f"[PLOT] saved: {path2}")


def main() -> None:
    curves = [
        Curve("当前 ratio-power（改用 progression view）", lambda x: current_ratio_power_in_progression_view(x, K=0.8, p=1.5, floor_ratio=0.1)),
        Curve("纯减法", subtractive_plain),
        Curve("C1: pre x^4, post 回归减法", lambda x: c1_power_then_line(x, threshold_value=0.25, pre_power=4.0, lift_decay=6.0)),
        Curve("C1+bump: 阈值25%, 导数峰值1.35", lambda x: c1_power_with_slope_bump(x, threshold_value=0.25, slope_bump=0.35, bump_decay=6.0)),
        Curve("smooth blend: 25%阈值抬升", lambda x: smooth_blend_power_to_line(x, threshold_value=0.25, pre_power=3.0, blend_half_width=0.28)),
    ]


    make_anchor_table(curves, xs=[0.25, 0.50, 0.80, 1.00, 1.10, 1.20, 1.50, 2.00, 3.00])
    make_derivative_table(curves, xs=[0.80, 0.90, 1.00, 1.10, 1.20, 1.50, 2.00])
    make_plots(curves)
    print("[DONE]")


if __name__ == "__main__":
    main()

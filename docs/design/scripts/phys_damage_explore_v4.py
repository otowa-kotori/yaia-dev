"""
物理伤害公式探索 v4

目标：
1. 聚焦“单弯折、少参数、易调”的候选；
2. 用 x = ATK / PDEF 视角比较 smooth-blend 家族；
3. 同时显示 damage / PDEF、damage / ATK、固定 PDEF 下绝对伤害；
4. 明确看 25% 阈值档位附近的曲线形态。

输出：
- docs/design/plots/phys_damage_simple_compare.png
- docs/design/plots/phys_damage_blend_width_sweep.png
- docs/design/plots/phys_damage_blend_threshold_sweep.png
- docs/design/plots/phys_damage_fixed_pdef_examples.png

运行：
  python docs/design/scripts/phys_damage_explore_v4.py
"""

from __future__ import annotations

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


def current_ratio_power(x: float, *, K: float = 0.8, p: float = 1.5, floor_ratio: float = 0.1) -> float:
    if x <= 0:
        return 0.0
    if x >= 1.0:
        return x
    excess = 1.0 / x - 1.0
    coeff = max(floor_ratio, K / (K + excess**p))
    return x * coeff


def subtractive_plain(x: float) -> float:
    return max(0.0, x - 1.0)


def smooth_blend(x: float, *, threshold_value: float = 0.25, pre_power: float = 3.0, blend_half_width: float = 0.28) -> float:
    """
    简洁候选：单次平滑混合。

    x = ATK / PDEF, y = damage / PDEF

    pre:  y = t * x^a
    post: y = (x - 1) + t
    y   = mix(pre, post, smoothstep(1-d, 1+d, x))

    参数语义：
    - t: x=1 时的命中伤害（20% / 25% / 30%）
    - a: 破甲前曲线弯曲程度（建议固定在 3 左右）
    - d: 过渡带半宽；越小越像“硬破甲线”，越大越圆润

    注意：这个族的远端渐近线是 x - 1 + t，而不是纯 x - 1。
    也就是说，它会保留一个常数抬升量，手感顺但会比纯减法更宽松。
    """
    if x <= 0:
        return 0.0
    t = threshold_value
    pre = t * (x**pre_power)
    post = (x - 1.0) + t
    s = smoothstep(1.0 - blend_half_width, 1.0 + blend_half_width, x)
    return (1.0 - s) * pre + s * post


def rational_return_to_line(x: float, *, threshold_value: float = 0.25, return_speed: float = 1.0) -> float:
    """
    更简洁的单弯折候选：阈值抬升，但会逐步回归纯减法。

    x = ATK / PDEF, y = damage / PDEF

    x <= 1:
      y = t * x^a
    x > 1:
      y = (x - 1) + t / (1 + m * (x - 1))

    其中：
    - t = y(1)，即阈值伤害（例如 25%）
    - m = return_speed，决定抬升量回归纯减法的速度
    - a = (1 - t*m) / t，使 x=1 左右导数一致（C1）

    约束：m < 1/t，否则 pre_power <= 0，不合法。

    这个族只有两个真参数（t, m），而且语义直白：
    - t 调“刚破甲能打多少”
    - m 调“多快回到 ATK-DEF 直觉”
    """
    if x <= 0:
        return 0.0
    t = threshold_value
    m = return_speed
    if m >= 1.0 / t:
        raise ValueError("return_speed must be < 1 / threshold_value")
    pre_power = (1.0 - t * m) / t
    if x <= 1.0:
        return t * (x**pre_power)
    dx = x - 1.0
    return dx + t / (1.0 + m * dx)



def make_anchor_table(curves: list[Curve], xs: list[float]) -> None:
    print("=" * 160)
    print("锚点表：x = ATK / PDEF")
    print("- y1 = damage / PDEF（固定怪物时看绝对伤害成长）")
    print("- y2 = damage / ATK  = (damage / PDEF) / (ATK / PDEF)")
    print("=" * 160)
    header = f"{'x':>6}"
    for curve in curves:
        header += f" {curve.name:>30}"
    print(header)
    print("-" * len(header))

    for x in xs:
        line = f"{x:>6.2f}"
        for curve in curves:
            y = curve.fn(x)
            line += f" {y:>9.3f}/{(y / x):>6.1%}"
        print(line)


def plot_compare(curves: list[Curve]) -> None:
    if not HAS_MPL:
        print("[WARN] matplotlib 未安装，跳过作图。")
        return

    xs = [i / 100 for i in range(5, 401)]

    fig, axes = plt.subplots(2, 2, figsize=(15, 10))
    fig.suptitle("简洁候选对比：单弯折优先", fontsize=15)

    ax = axes[0][0]
    for curve in curves:
        ax.plot(xs, [curve.fn(x) for x in xs], linewidth=2, label=curve.name)
    ax.axvline(1.0, color="red", linestyle="--", alpha=0.5, label="ATK=PDEF")
    ax.set_title("damage / PDEF")
    ax.set_xlabel("ATK / PDEF")
    ax.set_ylabel("damage / PDEF")
    ax.set_xlim(0, 4.0)
    ax.set_ylim(0, 3.2)
    ax.grid(True, alpha=0.3)
    ax.legend(fontsize=9)

    ax = axes[0][1]
    for curve in curves:
        ax.plot(xs, [curve.fn(x) / x for x in xs], linewidth=2, label=curve.name)
    ax.axvline(1.0, color="red", linestyle="--", alpha=0.5)
    ax.set_title("damage / ATK")
    ax.set_xlabel("ATK / PDEF")
    ax.set_ylabel("damage / ATK")
    ax.set_xlim(0, 4.0)
    ax.set_ylim(0, 1.05)
    ax.grid(True, alpha=0.3)
    ax.legend(fontsize=9)

    sub_xs = [x for x in xs if 0.6 <= x <= 1.6]
    ax = axes[1][0]
    for curve in curves:
        ax.plot(sub_xs, [curve.fn(x) for x in sub_xs], linewidth=2, label=curve.name)
    ax.axvline(1.0, color="red", linestyle="--", alpha=0.5)
    ax.set_title("阈值附近放大：damage / PDEF")
    ax.set_xlabel("ATK / PDEF")
    ax.set_ylabel("damage / PDEF")
    ax.grid(True, alpha=0.3)
    ax.legend(fontsize=9)

    ax = axes[1][1]
    for curve in curves:
        ax.plot(sub_xs, [derivative(curve.fn, x) for x in sub_xs], linewidth=2, label=curve.name)
    ax.axvline(1.0, color="red", linestyle="--", alpha=0.5)
    ax.set_title("阈值附近导数")
    ax.set_xlabel("ATK / PDEF")
    ax.set_ylabel("d(damage/PDEF) / d(ATK/PDEF)")
    ax.grid(True, alpha=0.3)
    ax.legend(fontsize=9)

    fig.tight_layout()
    path = os.path.join(OUTPUT_DIR, "phys_damage_simple_compare.png")
    fig.savefig(path, dpi=160)
    print(f"[PLOT] saved: {path}")


def plot_blend_width_sweep() -> None:
    if not HAS_MPL:
        return

    xs = [i / 100 for i in range(5, 301)]
    widths = [0.18, 0.28, 0.40]

    fig, axes = plt.subplots(1, 2, figsize=(14, 5.5))
    fig.suptitle("smooth-blend：过渡宽度 sweep（阈值固定 25%）", fontsize=15)

    ax = axes[0]
    for width in widths:
        ys = [smooth_blend(x, threshold_value=0.25, pre_power=3.0, blend_half_width=width) / x for x in xs]
        ax.plot(xs, ys, linewidth=2, label=f"width={width:.2f}")
    ax.axvline(1.0, color="red", linestyle="--", alpha=0.5)
    ax.set_title("damage / ATK")
    ax.set_xlabel("ATK / PDEF")
    ax.set_ylabel("damage / ATK")
    ax.set_xlim(0, 3.0)
    ax.set_ylim(0, 1.05)
    ax.grid(True, alpha=0.3)
    ax.legend(fontsize=9)

    ax = axes[1]
    sub_xs = [x for x in xs if 0.6 <= x <= 1.6]
    for width in widths:
        ys = [derivative(lambda t: smooth_blend(t, threshold_value=0.25, pre_power=3.0, blend_half_width=width), x) for x in sub_xs]
        ax.plot(sub_xs, ys, linewidth=2, label=f"width={width:.2f}")
    ax.axvline(1.0, color="red", linestyle="--", alpha=0.5)
    ax.set_title("阈值附近导数")
    ax.set_xlabel("ATK / PDEF")
    ax.set_ylabel("derivative")
    ax.grid(True, alpha=0.3)
    ax.legend(fontsize=9)

    fig.tight_layout()
    path = os.path.join(OUTPUT_DIR, "phys_damage_blend_width_sweep.png")
    fig.savefig(path, dpi=160)
    print(f"[PLOT] saved: {path}")


def plot_blend_threshold_sweep() -> None:
    if not HAS_MPL:
        return

    xs = [i / 100 for i in range(5, 301)]
    thresholds = [0.20, 0.25, 0.30]

    fig, axes = plt.subplots(1, 2, figsize=(14, 5.5))
    fig.suptitle("smooth-blend：阈值档位 sweep（width 固定 0.28）", fontsize=15)

    ax = axes[0]
    for threshold in thresholds:
        ys = [smooth_blend(x, threshold_value=threshold, pre_power=3.0, blend_half_width=0.28) / x for x in xs]
        ax.plot(xs, ys, linewidth=2, label=f"threshold={threshold:.0%}")
    ax.axvline(1.0, color="red", linestyle="--", alpha=0.5)
    ax.set_title("damage / ATK")
    ax.set_xlabel("ATK / PDEF")
    ax.set_ylabel("damage / ATK")
    ax.set_xlim(0, 3.0)
    ax.set_ylim(0, 1.05)
    ax.grid(True, alpha=0.3)
    ax.legend(fontsize=9)

    ax = axes[1]
    sub_xs = [x for x in xs if 0.6 <= x <= 1.6]
    for threshold in thresholds:
        ys = [smooth_blend(x, threshold_value=threshold, pre_power=3.0, blend_half_width=0.28) for x in sub_xs]
        ax.plot(sub_xs, ys, linewidth=2, label=f"threshold={threshold:.0%}")
    ax.axvline(1.0, color="red", linestyle="--", alpha=0.5)
    ax.set_title("阈值附近 damage / PDEF")
    ax.set_xlabel("ATK / PDEF")
    ax.set_ylabel("damage / PDEF")
    ax.grid(True, alpha=0.3)
    ax.legend(fontsize=9)

    fig.tight_layout()
    path = os.path.join(OUTPUT_DIR, "phys_damage_blend_threshold_sweep.png")
    fig.savefig(path, dpi=160)
    print(f"[PLOT] saved: {path}")


def plot_return_speed_sweep() -> None:
    if not HAS_MPL:
        return

    xs = [i / 100 for i in range(5, 301)]
    speeds = [0.7, 1.0, 1.5]

    fig, axes = plt.subplots(1, 2, figsize=(14, 5.5))
    fig.suptitle("return-to-line：回归速度 sweep（阈值固定 25%）", fontsize=15)

    ax = axes[0]
    for speed in speeds:
        ys = [rational_return_to_line(x, threshold_value=0.25, return_speed=speed) / x for x in xs]
        ax.plot(xs, ys, linewidth=2, label=f"speed={speed:.1f}")
    ax.axvline(1.0, color="red", linestyle="--", alpha=0.5)
    ax.set_title("damage / ATK")
    ax.set_xlabel("ATK / PDEF")
    ax.set_ylabel("damage / ATK")
    ax.set_xlim(0, 3.0)
    ax.set_ylim(0, 1.05)
    ax.grid(True, alpha=0.3)
    ax.legend(fontsize=9)

    ax = axes[1]
    sub_xs = [x for x in xs if 0.6 <= x <= 1.6]
    for speed in speeds:
        ys = [derivative(lambda t: rational_return_to_line(t, threshold_value=0.25, return_speed=speed), x) for x in sub_xs]
        ax.plot(sub_xs, ys, linewidth=2, label=f"speed={speed:.1f}")
    ax.axvline(1.0, color="red", linestyle="--", alpha=0.5)
    ax.set_title("阈值附近导数")
    ax.set_xlabel("ATK / PDEF")
    ax.set_ylabel("derivative")
    ax.grid(True, alpha=0.3)
    ax.legend(fontsize=9)

    fig.tight_layout()
    path = os.path.join(OUTPUT_DIR, "phys_damage_return_speed_sweep.png")
    fig.savefig(path, dpi=160)
    print(f"[PLOT] saved: {path}")


def plot_fixed_pdef_examples() -> None:

    if not HAS_MPL:
        return

    atks = list(range(1, 241))
    pdefs = [40, 100]
    candidates = [
        Curve("当前 ratio-power", lambda x: current_ratio_power(x, K=0.8, p=1.5, floor_ratio=0.1)),
        Curve("纯减法", subtractive_plain),
        Curve("blend 25%, width=0.28", lambda x: smooth_blend(x, threshold_value=0.25, pre_power=3.0, blend_half_width=0.28)),
        Curve("return 25%, speed=1.0", lambda x: rational_return_to_line(x, threshold_value=0.25, return_speed=1.0)),
        Curve("return 25%, speed=1.5", lambda x: rational_return_to_line(x, threshold_value=0.25, return_speed=1.5)),
    ]


    fig, axes = plt.subplots(1, 2, figsize=(14, 5.5))
    fig.suptitle("固定怪物护甲时，玩家堆 ATK 的绝对伤害成长", fontsize=15)

    for idx, pdef in enumerate(pdefs):
        ax = axes[idx]
        for curve in candidates:
            damages = [curve.fn(atk / pdef) * pdef for atk in atks]
            ax.plot(atks, damages, linewidth=2, label=curve.name)
        ax.axvline(pdef, color="red", linestyle="--", alpha=0.5, label="ATK=PDEF")
        ax.set_title(f"固定 PDEF={pdef}")
        ax.set_xlabel("ATK")
        ax.set_ylabel("damage")
        ax.grid(True, alpha=0.3)
        ax.legend(fontsize=8)

    fig.tight_layout()
    path = os.path.join(OUTPUT_DIR, "phys_damage_fixed_pdef_examples.png")
    fig.savefig(path, dpi=160)
    print(f"[PLOT] saved: {path}")


def main() -> None:
    curves = [
        Curve("当前 ratio-power", lambda x: current_ratio_power(x, K=0.8, p=1.5, floor_ratio=0.1)),
        Curve("纯减法", subtractive_plain),
        Curve("blend 25%, width=0.28", lambda x: smooth_blend(x, threshold_value=0.25, pre_power=3.0, blend_half_width=0.28)),
        Curve("return 25%, speed=1.0", lambda x: rational_return_to_line(x, threshold_value=0.25, return_speed=1.0)),
        Curve("return 25%, speed=1.5", lambda x: rational_return_to_line(x, threshold_value=0.25, return_speed=1.5)),
    ]


    make_anchor_table(curves, xs=[0.50, 0.80, 1.00, 1.10, 1.20, 1.50, 2.00, 3.00])
    plot_compare(curves)
    plot_blend_width_sweep()
    plot_blend_threshold_sweep()
    plot_return_speed_sweep()
    plot_fixed_pdef_examples()
    print("[DONE]")



if __name__ == "__main__":
    main()

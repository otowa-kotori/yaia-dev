"""
物理伤害公式探索 v2

目标：
1. 保留用户偏好的 "ATK - DEF" 直觉感；
2. 对比当前 ratio-power 方案在破甲后的平台感；
3. 观察高甲尾部到底该保留多大兜底；
4. 用图表辅助决定：门槛感 / 弱怪刮痧 / 极高甲不可挂 之间怎么取舍。

输出：
- docs/design/plots/phys_damage_formula_compare.png
- docs/design/plots/phys_damage_hybrid_sweep.png

运行：
  python docs/design/scripts/phys_damage_explore_v2.py
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
class Formula:
    name: str
    fn: Callable[[float, float], float]


def ratio_power_current(atk: float, pdef: float, *, K: float = 0.8, p: float = 1.5, floor_ratio: float = 0.1) -> float:
    """当前实现：一旦破甲（pdef <= atk）就回到满伤。"""
    if atk <= 0:
        return 0.0
    excess = max(0.0, pdef / atk - 1.0)
    coeff = max(floor_ratio, K / (K + excess**p))
    return atk * coeff


def subtractive_hard_floor(atk: float, pdef: float, *, floor_ratio: float = 0.1) -> float:
    """纯减法 + 固定比例兜底。直觉最强，但高甲没有继续 scaling。"""
    if atk <= 0:
        return 0.0
    return max(atk - pdef, atk * floor_ratio)


def subtractive_tail_hybrid(
    atk: float,
    pdef: float,
    *,
    plateau_ratio: float = 0.15,
    K: float = 0.8,
    p: float = 1.5,
    abs_floor: float = 0.0,
) -> float:
    """
    提案：减法直觉 + 阈值平台 + 高甲长尾。

    - 大优势区：damage = atk - def（保留经典直觉）
    - 临近破防区：不低于 plateau_ratio * atk（10~20% 这种“很难受但还能打”的平台）
    - 未破防高甲区：平台再乘一个 ratio-power 尾部，继续往下掉，不是无限 10%

    公式：
      direct = atk - def
      tailCoeff = 1, if pdef/atk <= 1
                = K / (K + (pdef/atk - 1)^p), otherwise
      tail = atk * plateau_ratio * tailCoeff
      damage = max(abs_floor, direct, tail)
    """
    if atk <= 0:
        return 0.0
    ratio = pdef / atk
    if ratio <= 1.0:
        tail_coeff = 1.0
    else:
        tail_coeff = K / (K + (ratio - 1.0) ** p)
    direct = atk - pdef
    tail = atk * plateau_ratio * tail_coeff
    return max(abs_floor, direct, tail)


def coeff(damage: float, atk: float) -> float:
    return 0.0 if atk <= 0 else damage / atk


def print_anchor_table(formulas: list[Formula], atk: float, ratios: list[float]) -> None:
    print("=" * 120)
    print(f"锚点表：ATK={atk:g}")
    print("ratio = PDEF / ATK")
    print("=" * 120)
    header = f"{'ratio':>7} {'PDEF':>7}"
    for formula in formulas:
        header += f" {formula.name:>22}"
    print(header)
    print("-" * len(header))

    for ratio in ratios:
        pdef = atk * ratio
        line = f"{ratio:>7.2f} {pdef:>7.1f}"
        for formula in formulas:
            damage = formula.fn(atk, pdef)
            line += f" {damage:>9.2f} ({coeff(damage, atk):>5.1%})"
        print(line)


def print_scaling_table(formula: Formula, atks: list[float], ratios: list[float]) -> None:
    print()
    print("=" * 120)
    print(f"缩放一致性：{formula.name}")
    print("同一 ratio 下，不同攻击档位的伤害系数是否符合预期")
    print("=" * 120)
    header = f"{'ratio':>7}"
    for atk in atks:
        header += f" {('ATK=' + str(int(atk))):>18}"
    print(header)
    print("-" * len(header))

    for ratio in ratios:
        line = f"{ratio:>7.2f}"
        for atk in atks:
            pdef = atk * ratio
            damage = formula.fn(atk, pdef)
            line += f" {damage:>8.2f}/{coeff(damage, atk):>7.1%}"
        print(line)


def make_compare_plot(formulas: list[Formula]) -> None:
    if not HAS_MPL:
        print("[WARN] matplotlib 未安装，跳过作图。")
        return

    ratios = [x / 100 for x in range(0, 601)]
    atk = 100.0
    pdefs = [atk * r for r in ratios]

    fig, axes = plt.subplots(2, 2, figsize=(15, 11))
    fig.suptitle("物理伤害公式对比：直觉感、门槛感与高甲尾部", fontsize=15)

    # 1) 系数曲线：全域
    ax = axes[0][0]
    for formula in formulas:
        ys = [coeff(formula.fn(atk, pdef), atk) for pdef in pdefs]
        ax.plot(ratios, ys, label=formula.name, linewidth=2)
    ax.axvline(1.0, color="red", linestyle="--", alpha=0.5, label="PDEF = ATK")
    ax.set_title("全域伤害系数曲线")
    ax.set_xlabel("PDEF / ATK")
    ax.set_ylabel("damage / ATK")
    ax.set_ylim(0, 1.05)
    ax.grid(True, alpha=0.3)
    ax.legend(fontsize=9)

    # 2) 绝对伤害：ATK=100
    ax = axes[0][1]
    for formula in formulas:
        ys = [formula.fn(atk, pdef) for pdef in pdefs]
        ax.plot(pdefs, ys, label=formula.name, linewidth=2)
    ax.axvline(atk, color="red", linestyle="--", alpha=0.5, label="PDEF = ATK")
    ax.set_title("ATK=100 时的绝对伤害")
    ax.set_xlabel("PDEF")
    ax.set_ylabel("damage")
    ax.set_ylim(0, atk * 1.02)
    ax.grid(True, alpha=0.3)
    ax.legend(fontsize=9)

    # 3) 高甲尾部：放大看 ratio > 1
    ax = axes[1][0]
    hi_ratios = [x / 100 for x in range(100, 601)]
    hi_pdefs = [atk * r for r in hi_ratios]
    for formula in formulas:
        ys = [max(0.001, coeff(formula.fn(atk, pdef), atk)) for pdef in hi_pdefs]
        ax.plot(hi_ratios, ys, label=formula.name, linewidth=2)
    ax.set_title("高甲尾部（对数纵轴）")
    ax.set_xlabel("PDEF / ATK")
    ax.set_ylabel("damage / ATK")
    ax.set_yscale("log")
    ax.grid(True, alpha=0.3, which="both")
    ax.legend(fontsize=9)

    # 4) 三个攻击档位：看弱怪/强怪的绝对变化
    ax = axes[1][1]
    sample_formula = formulas[2]  # hybrid 15%
    sample_atks = [40.0, 100.0, 250.0]
    for sample_atk in sample_atks:
        ys = [sample_formula.fn(sample_atk, pdef) for pdef in [sample_atk * r for r in ratios]]
        ax.plot(ratios, ys, label=f"{sample_formula.name} | ATK={int(sample_atk)}", linewidth=2)
    ax.axvline(1.0, color="red", linestyle="--", alpha=0.5)
    ax.set_title("同一混合公式下，不同攻击档位的绝对伤害")
    ax.set_xlabel("PDEF / ATK")
    ax.set_ylabel("damage")
    ax.grid(True, alpha=0.3)
    ax.legend(fontsize=9)

    fig.tight_layout()
    path = os.path.join(OUTPUT_DIR, "phys_damage_formula_compare.png")
    fig.savefig(path, dpi=160)
    print(f"[PLOT] saved: {path}")


def make_hybrid_sweep_plot() -> None:
    if not HAS_MPL:
        return

    ratios = [x / 100 for x in range(0, 601)]
    atk = 100.0

    fig, axes = plt.subplots(1, 2, figsize=(14, 5.5))
    fig.suptitle("混合公式参数扫图", fontsize=15)

    # 左：平台高度
    ax = axes[0]
    for plateau in [0.10, 0.15, 0.20]:
        ys = [
            coeff(subtractive_tail_hybrid(atk, atk * ratio, plateau_ratio=plateau, K=0.8, p=1.5), atk)
            for ratio in ratios
        ]
        ax.plot(ratios, ys, label=f"platform={plateau:.0%}", linewidth=2)
    ax.axvline(1.0, color="red", linestyle="--", alpha=0.5)
    ax.set_title("平台高度：10% / 15% / 20%")
    ax.set_xlabel("PDEF / ATK")
    ax.set_ylabel("damage / ATK")
    ax.set_ylim(0, 1.05)
    ax.grid(True, alpha=0.3)
    ax.legend(fontsize=9)

    # 右：尾部陡峭度
    ax = axes[1]
    for p in [1.0, 1.5, 2.0]:
        ys = [
            coeff(subtractive_tail_hybrid(atk, atk * ratio, plateau_ratio=0.15, K=0.8, p=p), atk)
            for ratio in ratios
        ]
        ax.plot(ratios, ys, label=f"tail p={p:.1f}", linewidth=2)
    ax.axvline(1.0, color="red", linestyle="--", alpha=0.5)
    ax.set_title("高甲尾部陡峭度：p=1.0 / 1.5 / 2.0")
    ax.set_xlabel("PDEF / ATK")
    ax.set_ylabel("damage / ATK")
    ax.set_ylim(0, 1.05)
    ax.grid(True, alpha=0.3)
    ax.legend(fontsize=9)

    fig.tight_layout()
    path = os.path.join(OUTPUT_DIR, "phys_damage_hybrid_sweep.png")
    fig.savefig(path, dpi=160)
    print(f"[PLOT] saved: {path}")


def main() -> None:
    formulas = [
        Formula("current ratio-power 10%底", lambda atk, pdef: ratio_power_current(atk, pdef, K=0.8, p=1.5, floor_ratio=0.1)),
        Formula("减法 + 固定10%底", lambda atk, pdef: subtractive_hard_floor(atk, pdef, floor_ratio=0.1)),
        Formula("混合: 平台15% + 高甲尾部", lambda atk, pdef: subtractive_tail_hybrid(atk, pdef, plateau_ratio=0.15, K=0.8, p=1.5)),
        Formula("混合: 平台20% + 高甲尾部", lambda atk, pdef: subtractive_tail_hybrid(atk, pdef, plateau_ratio=0.20, K=0.8, p=1.5)),
    ]

    print_anchor_table(formulas, atk=100.0, ratios=[0.0, 0.2, 0.5, 0.8, 1.0, 1.2, 1.5, 2.0, 3.0, 5.0])
    print_scaling_table(formulas[0], atks=[40.0, 100.0, 250.0], ratios=[0.5, 1.0, 1.5, 2.0, 3.0])
    print_scaling_table(formulas[2], atks=[40.0, 100.0, 250.0], ratios=[0.5, 1.0, 1.5, 2.0, 3.0])

    make_compare_plot(formulas)
    make_hybrid_sweep_plot()
    print("[DONE]")


if __name__ == "__main__":
    main()

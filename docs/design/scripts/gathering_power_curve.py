"""
采集力（Gathering Power）概率曲线探索。

核心参数：r = gatherPower / nodeDifficulty

r < 1: 可能失败
r = 1: 稳定 1 个
r >> 1: 最高期望 4 个/swing
"""

import numpy as np
import matplotlib.pyplot as plt

r_values = np.linspace(0.1, 6.0, 200)

# --- 方案 A: 简单分段 ---
# r<1: success_rate = r^2, yield = 0 or 1
# r>=1: always success, expected_yield = 1 + 3*(1 - 1/r)
def scheme_a(r):
    if r < 1:
        return r**2 * 1  # expected = success_rate * 1
    else:
        return 1 + 3 * (1 - 1/r)

# --- 方案 B: 更平滑 ---
# r<1: success_rate = r^1.5
# r>=1: expected_yield = 1 + 3*(1 - 1/r^0.7)
# r^0.7 让增益前快后慢
def scheme_b(r):
    if r < 1:
        return r**1.5 * 1
    else:
        return 1 + 3 * (1 - 1/(r**0.7))

# --- 方案 C: 用统一 sigmoid 风味 ---
# expected = 4 * r^2 / (r^2 + K)
# K 控制半饱和点。K=3 时: r=1 → 4*1/4 = 1.0 ✓, r→∞ → 4.0 ✓
def scheme_c(r):
    K = 3
    return 4 * r**2 / (r**2 + K)

ya = [scheme_a(r) for r in r_values]
yb = [scheme_b(r) for r in r_values]
yc = [scheme_c(r) for r in r_values]

fig, axes = plt.subplots(1, 3, figsize=(18, 6))
fig.suptitle('Gathering Power → Expected Yield per Swing', fontsize=14)

for ax, y, label, color in [
    (axes[0], ya, 'A: r²/分段 + 3(1-1/r)', 'steelblue'),
    (axes[1], yb, 'B: r^1.5 + 3(1-1/r^0.7)', 'seagreen'),
    (axes[2], yc, 'C: 4r²/(r²+3) unified', 'coral'),
]:
    ax.plot(r_values, y, color=color, linewidth=2)
    ax.axhline(y=1, color='gray', linestyle='--', alpha=0.5, label='yield=1')
    ax.axhline(y=4, color='gray', linestyle=':', alpha=0.5, label='yield=4 (cap)')
    ax.axvline(x=1, color='gray', linestyle='--', alpha=0.5, label='r=1')
    ax.set_xlabel('r = gatherPower / difficulty')
    ax.set_ylabel('Expected Yield')
    ax.set_title(label)
    ax.set_ylim(-0.1, 4.5)
    ax.set_xlim(0, 6)
    ax.grid(True, alpha=0.3)

    # 标注关键点
    key_rs = [0.5, 0.7, 1.0, 1.5, 2.0, 3.0, 4.0, 5.0]
    for kr in key_rs:
        if label.startswith('A'):
            val = scheme_a(kr)
        elif label.startswith('B'):
            val = scheme_b(kr)
        else:
            val = scheme_c(kr)
        ax.plot(kr, val, 'o', color=color, markersize=4)
        ax.annotate(f'{val:.2f}', (kr, val), textcoords="offset points",
                   xytext=(5, 5), fontsize=7)

plt.tight_layout()
plt.savefig('docs/design/plots/gathering_power_curve.png', dpi=150)
plt.close()

# 打印数值表
print("=" * 70)
print(f"{'r':>5} | {'A: expected':>12} | {'B: expected':>12} | {'C: expected':>12}")
print("-" * 70)
for r in [0.3, 0.5, 0.7, 0.8, 0.9, 1.0, 1.2, 1.5, 2.0, 2.5, 3.0, 4.0, 5.0, 6.0]:
    a = scheme_a(r)
    b = scheme_b(r)
    c = scheme_c(r)
    print(f"{r:>5.1f} | {a:>12.3f} | {b:>12.3f} | {c:>12.3f}")

print("\n关键指标对比:")
print(f"{'指标':>20} | {'A':>8} | {'B':>8} | {'C':>8}")
print("-" * 55)
for label, r in [("r=0.5 (半力)", 0.5), ("r=0.7 (七成力)", 0.7),
                  ("r=1.0 (达标)", 1.0), ("r=1.5 (超50%)", 1.5),
                  ("r=2.0 (翻倍)", 2.0), ("r=3.0 (三倍力)", 3.0),
                  ("r=4.0 (四倍力)", 4.0)]:
    a, b, c = scheme_a(r), scheme_b(r), scheme_c(r)
    print(f"{label:>20} | {a:>8.2f} | {b:>8.2f} | {c:>8.2f}")

# 计算各方案达到期望3.0和3.5的r值
print("\n到达目标期望值需要的 r:")
for target in [2.0, 3.0, 3.5, 3.8]:
    for r_test in np.linspace(1.0, 10.0, 1000):
        a = scheme_a(r_test)
        if a >= target:
            ra = r_test
            break
    for r_test in np.linspace(1.0, 10.0, 1000):
        b = scheme_b(r_test)
        if b >= target:
            rb = r_test
            break
    for r_test in np.linspace(1.0, 10.0, 1000):
        c = scheme_c(r_test)
        if c >= target:
            rc = r_test
            break
    print(f"  期望={target:.1f}: A需r={ra:.1f}, B需r={rb:.1f}, C需r={rc:.1f}")

"""
方案 C 调参：4r²/(r²+K)，不同 K 值对比。
K 越小，增长越快（低 r 就能接近 4）。
K 越大，增长越慢（需要高 r 才接近 4）。

设计目标：
  - r=1 → 期望 = 1.0
  - r=2 → 期望 ≈ 2.5
  - r=4 → 期望 ≈ 3.5+
  - r<1 → 自然衰减（等效失败率）
"""
import numpy as np
import matplotlib.pyplot as plt

r_values = np.linspace(0.1, 6.0, 200)

# 通用公式: cap * r^p / (r^p + K)
# 约束: r=1 时 = 1.0  →  cap * 1 / (1 + K) = 1  →  K = cap - 1
# 所以 K 自动由 cap 决定！cap=4 → K=3

# 但如果我们放松 r=1 = 1.0 的约束，或者用不同的 p：
# cap * r^p / (r^p + K) = 1 when r=1  →  cap/(1+K) = 1  →  K = cap-1

# 结论：如果要 r=1→1 且 cap=4，K 必须是 3。这是数学约束。
# 要调的是 p：
#   p > 2: r>1 后增长更快，r<1 衰减更陡
#   p < 2: r>1 后增长更慢，r<1 衰减更缓

def scheme(r, p, cap=4.0):
    K = cap - 1  # 保证 r=1 → 1.0
    return cap * r**p / (r**p + K)

p_values = [1.5, 2.0, 2.5, 3.0]
colors = ['steelblue', 'seagreen', 'coral', 'orchid']

fig, ax = plt.subplots(figsize=(10, 7))

for p, color in zip(p_values, colors):
    y = [scheme(r, p) for r in r_values]
    ax.plot(r_values, y, color=color, linewidth=2, label=f'p={p}')

ax.axhline(y=1, color='gray', linestyle='--', alpha=0.4)
ax.axhline(y=4, color='gray', linestyle=':', alpha=0.4)
ax.axvline(x=1, color='gray', linestyle='--', alpha=0.4)
ax.set_xlabel('r = gatherPower / difficulty', fontsize=12)
ax.set_ylabel('Expected Yield per Swing', fontsize=12)
ax.set_title('4r^p / (r^p + 3) with different p values', fontsize=14)
ax.set_ylim(-0.1, 4.5)
ax.set_xlim(0, 6)
ax.grid(True, alpha=0.3)
ax.legend(fontsize=12)

plt.tight_layout()
plt.savefig('docs/design/plots/gathering_power_curve_v2.png', dpi=150)
plt.close()

# 数值表
print("4r^p / (r^p + 3), cap=4, K=3")
print("=" * 65)
header = f"{'r':>5}"
for p in p_values:
    header += f" | {'p='+str(p):>10}"
print(header)
print("-" * 65)

for r in [0.3, 0.5, 0.7, 0.8, 0.9, 1.0, 1.2, 1.5, 2.0, 2.5, 3.0, 4.0, 5.0]:
    row = f"{r:>5.1f}"
    for p in p_values:
        row += f" | {scheme(r, p):>10.2f}"
    print(row)

print("\n关键问题：达到期望 3.5 需要多大的 r？")
for p in p_values:
    for r_test in np.linspace(1.0, 20.0, 5000):
        if scheme(r_test, p) >= 3.5:
            print(f"  p={p}: r={r_test:.1f}")
            break

# 实际游戏场景估算
print("\n--- 实际场景 ---")
print("假设：铜矿难度=10, 铁矿难度=30")
print("      训练镐采集力+3, 铜镐+8, 铁镐+18")
print("      技能等级贡献: level*1 (简化)")
print()

scenarios = [
    ("Lv1+训练镐 vs 铜矿", (1+3)/10),
    ("Lv5+铜镐 vs 铜矿", (5+8)/10),
    ("Lv10+铜镐 vs 铜矿", (10+8)/10),
    ("Lv15+铜镐 vs 铜矿", (15+8)/10),
    ("Lv20+铁镐 vs 铜矿", (20+18)/10),
    ("Lv5+训练镐 vs 铁矿", (5+3)/30),
    ("Lv10+铜镐 vs 铁矿", (10+8)/30),
    ("Lv15+铜镐 vs 铁矿", (15+8)/30),
    ("Lv20+铁镐 vs 铁矿", (20+18)/30),
    ("Lv30+铁镐 vs 铁矿", (30+18)/30),
]

print(f"{'场景':>30} | {'r':>5} | {'p=2 yield':>10} | {'p=2.5 yield':>12}")
print("-" * 75)
for name, r in scenarios:
    y2 = scheme(r, 2.0)
    y25 = scheme(r, 2.5)
    print(f"{name:>30} | {r:>5.2f} | {y2:>10.2f} | {y25:>12.2f}")

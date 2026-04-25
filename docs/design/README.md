# 新手阶段数值设计（Lv 1 → 30 · Boss 通关）

> **状态**：方向探索阶段，各模块独立迭代  
> **范围**：从新游戏开始到击败第一个 Boss 副本  
> **方法**：先定方向和理念，再逐步细化数值；配合脚本/模拟工具验证

## 文档地图

| 文档 | 内容 | 状态 | 依赖 |
|------|------|------|------|
| [flow.md](./flow.md) | 新手心流总览：阶段划分、节奏、情感目标 | 方向已定 | — |
| [combat-formula.md](./combat-formula.md) | 属性体系与战斗公式：物理/魔法双管线、破甲线 | 探索中 | — |
| [jobs.md](./jobs.md) | 职业与技能：四职业定位、技能树方向 | 探索中 | combat-formula |
| [equipment.md](./equipment.md) | 装备与强化：装备梯度、强化系统 | 探索中 | combat-formula, jobs |
| [monsters.md](./monsters.md) | 怪物与区域：敌人设计理念、区域划分 | 探索中 | combat-formula, equipment |
| [gathering.md](./gathering.md) | 采集与生产：材料体系、生产链 | 探索中 | equipment, monsters |
| [progression.md](./progression.md) | 经验公式与成长节奏：XP 曲线、等级差递减 | 探索中 | flow, monsters |
| [skill-system.md](./skill-system.md) | 技能系统架构：TalentDef/EffectDef、reaction dispatch、intent | 设计稿 | combat-formula, jobs |
| [reactive-attrs.md](./reactive-attrs.md) | 响应式属性：派生 base、动态 modifier、lazy invalidation | 设计稿 | combat-formula, skill-system |

## 级联更新规则

```
combat-formula 变动 → 检查 jobs, equipment, monsters, skill-system, reactive-attrs
equipment 变动 → 检查 monsters, gathering
monsters 变动 → 检查 flow 的数值锚点, progression
progression 变动 → 检查 flow 的阶段时间线
skill-system 变动 → 检查 reactive-attrs, monsters
reactive-attrs 变动 → 检查 skill-system（属性刷新消费侧）
```

## 设计原则

1. **渐进解锁**：每个阶段只教一件新事。
2. **挂机有价值**：每次回来都能感到进展。
3. **操作有回报**：手动操作应比纯挂显著加速。
4. **打什么都有用**：不存在"白打"的怪物。
5. **不惩罚新手**：无强化失败、无死亡掉落。
6. **入门容易精通难**：前期快速上手，后期需要策略思考。
7. **先方向后数值**：每个模块先确定设计理念，再用工具拟合具体数字。

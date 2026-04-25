# content

静态内容的类型定义、注册表与新游戏起始配置。

## 定位

运行时各模块都只保存内容 ID；真正的定义统一放在 `ContentDb` 中查表读取。这样存档里不会塞入整块设计数据，内容修改也能保持集中。

## 职责

- **定义内容类型**：`ItemDef`、`MonsterDef`、`AbilityDef`、`EffectDef`、`SkillDef`、`ResourceNodeDef`、`UpgradeDef`、`AttrDef`、`TalentDef`、`RecipeDef`
- **提供聚合注册表**：`ContentDb` 作为所有静态设计数据的统一入口
- **承载起始配置**：`HeroConfig` 定义每个职业的 `baseAttrs`、`growth`、`physScaling`、`magScaling`、`knownAbilities`、`startingItems`；`StartingConfig` 汇总英雄列表与初始地点
- **提供默认内容包**：`src/content/index.ts` 维护当前 MVP 的默认内容

## HeroConfig 关键字段

| 字段 | 说明 |
|------|------|
| `baseAttrs` | Lv1 初始属性（覆盖 AttrDef.defaultBase） |
| `growth` | 每级增量；Speed 不成长，故不列入 |
| `physScaling` | 哪些一级属性贡献 PHYS_POTENCY → PATK |
| `magScaling` | 哪些一级属性贡献 MAG_POTENCY → MATK |
| `knownAbilities` | 初始已知技能；物理职业用 `ability.basic.attack`，魔法职业用 `ability.basic.magic_attack` |

这三个配置字段（growth / physScaling / magScaling）**只存于内容层**，通过 `PlayerCharacter.heroConfigId` 运行时查取，不持久化到存档。

## 当前默认内容

**材料**：`item.ore.copper`、`item.monster.slime_gel`

**武器**：

| ID | 名称 | 关键加成 |
|----|------|---------|
| `item.weapon.training_sword` | 训练木剑 | WEAPON_ATK +2 |
| `item.weapon.training_bow` | 训练短弓 | WEAPON_ATK +2 |
| `item.weapon.training_staff` | 训练法杖 | WEAPON_MATK +2 |
| `item.weapon.training_scepter` | 见习权杖 | WEAPON_MATK +2，MAX_MP +10 |
| `item.weapon.copper_sword` | 铜剑 | WEAPON_ATK +8 |

**怪物**：`monster.slime`、`monster.goblin`、`monster.cave_bat`

**技能**：`skill.mining`、`skill.smithing`

**配方**：`recipe.craft.copper_sword`

**升级商店**：战士训练（WEAPON_ATK flat +2/级）、护甲强化（PDEF flat +1/级）

## 关键约定

- **ID 命名**：统一使用点分命名空间，例如 `item.weapon.copper_sword`
- **内容保持纯数据**：定义只保存可序列化字段，不持有运行时实例
- **起始自动装备**：`session.resetToFresh()` 在发放起始物品后会自动装备背包内的 gear，确保新档一开局就有装备

## 边界

- **不负责运行时实例**：`GearInstance`、actor、battle、activity 都不在 content 层创建
- **不负责业务流程**：装备、合成、采集、战斗等命令由各自模块执行，content 只提供静态定义
- **不负责 UI 状态**：界面只消费定义，不回写 `ContentDb`

## 入口

- 类型定义：`src/core/content/types.ts`
- 默认内容：`src/content/index.ts`

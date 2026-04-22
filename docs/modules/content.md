# content

静态内容的类型定义、注册表与新游戏起始配置。

## 定位

运行时各模块都只保存内容 ID；真正的定义统一放在 `ContentDb` 中查表读取。这样存档里不会塞入整块设计数据，内容修改也能保持集中。

## 职责

- **定义内容类型**：`ItemDef`、`MonsterDef`、`AbilityDef`、`EffectDef`、`SkillDef`、`StageDef`、`ResourceNodeDef`、`UpgradeDef`、`AttrDef`、`TalentDef`、`RecipeDef`。
- **提供聚合注册表**：`ContentDb` 作为所有静态设计数据的统一入口。
- **承载起始配置**：`StartingConfig` 定义新游戏初始英雄、初始地点与每个英雄的 `startingItems`。
- **提供默认内容包**：`src/content/index.ts` 维护当前 MVP 的默认地图、怪物、材料、装备、技能、配方与升级。

## 当前默认内容

- **材料**：`item.ore.copper`、`item.monster.slime_gel`
- **装备**：`item.weapon.training_sword`、`item.weapon.copper_sword`
- **技能**：`skill.mining`、`skill.smithing`
- **配方**：`recipe.craft.copper_sword`
- **起始物品**：默认 `hero.1` 会在新档时获得一把 `训练木剑`

## 关键约定

- **ID 命名**：统一使用点分命名空间，例如 `item.weapon.copper_sword`、`recipe.craft.copper_sword`。
- **内容保持纯数据**：定义只保存可序列化字段，不持有运行时实例。
- **装备描述字段**：`ItemDef.description` 用于详情 UI 展示，不参与规则判断。
- **装备判定**：`ItemDef.slot` 存在时，该物品可被视为可装备 gear。
- **配方输出**：`RecipeDef.outputs` 可以同时支持材料与装备；装备产物必须继续走 `createGearInstance` 创建实例。
- **起始发放**：`HeroConfig.startingItems` 只描述“给什么”，真正发放由 `session.resetToFresh()` 执行。

## 边界

- **不负责运行时实例**：`GearInstance`、actor、battle、activity 都不在 content 层创建。
- **不负责业务流程**：装备、合成、采集、战斗等命令由各自模块执行，content 只提供静态定义。
- **不负责 UI 状态**：界面只消费定义，不回写 `ContentDb`。

## 入口

- 类型定义：`src/core/content/types.ts`
- 默认内容：`src/content/index.ts`

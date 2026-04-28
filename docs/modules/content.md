# content

静态内容的类型定义、作者层编排、默认内容包装配与注册表边界。

## 定位

运行时各模块都只保存内容 ID；真正的定义统一放在 `ContentDb` 中查表读取。`src/content` 负责把作者层拆分文件、模板和 `extends` 写法编译成最终的扁平 `ContentDb`，运行时不理解继承链，也不接触抽象模板。

## 职责

- **定义运行时内容类型**：`src/core/content/types.ts` 定义 `ItemDef`、`MonsterDef`、`EffectDef`、`SkillDef`、`TalentDef`、`RecipeDef`、`ResourceNodeDef`、`UpgradeDef`、`AttrDef`、`HeroConfig`、`StartingConfig`。其中 `MonsterDef.rewards`、`RecipeDef.cost`、`RecipeDef.rewards` 等使用 `economy` 模块定义的 `RewardBundle` / `CostDef` 类型；`WaveRewardDef` 是 `RewardBundle` 的别名。
- **维护作者层内容模块**：`src/content/default/` 按内容域拆分默认内容，例如 `items/`、`monsters/`、`heroes.ts`、`combat-zones.ts`
- **编译作者层继承**：`src/content/compiler/inheritance.ts` 负责解析单父 `extends`、检测循环、展开抽象模板，并按“对象递归合并 / 数组整体替换”规则产出最终定义
- **提供默认内容单例**：`DEFAULT_CONTENT` / `getDefaultContent()` / `buildDefaultContent()` 都返回同一个模块级默认内容对象，避免 UI 反复重建整包内容
- **承载新游戏起始配置**：英雄作者层先作为可继承集合编译，再回组装为 `starting.heroes` 与 `starting.initialLocationId`

## 继承规则

- **单继承**：每个内容节点最多只能有一个父节点，不支持多继承
- **树形结构**：允许模板继承模板、实体继承模板、实体继承实体
- **抽象模板不泄漏**：带 `abstract: true` 的节点只参与编译，不进入最终 `ContentDb`
- **合并规则**：
  - 标量字段：子级覆盖父级
  - 普通对象：递归合并
  - 数组字段：子级整体替换父级，不自动追加
- **运行时无感知**：`battle`、`session`、`save`、`registry` 读取到的始终是已经展开的最终定义

## HeroConfig 关键字段

| 字段 | 说明 |
|------|------|
| `baseAttrs` | Lv1 初始属性（覆盖 `AttrDef.defaultBase`） |
| `growth` | 每级增量；Speed 不成长，故不列入 |
| `physScaling` | 哪些一级属性贡献 `PHYS_POTENCY → PATK` |
| `magScaling` | 哪些一级属性贡献 `MAG_POTENCY → MATK` |
| `knownTalents` | 初始已知天赋；物理职业默认 `talent.basic.attack`，法系职业默认 `talent.basic.magic_attack` |
| `availableTalents` | 该职业可通过 TP 分配学习的天赋列表 |

`growth / physScaling / magScaling / availableTalents` 这些配置只存在于内容层，通过 `PlayerCharacter.heroConfigId` 运行时回查，不持久化到存档里。

## 当前默认内容组织

- **共享基础**：`attributes.ts`、`formulas.ts`、`currencies.ts`、`effects.ts`、`talents.ts`
- **物品**：`items/templates.ts`、`items/materials.ts`、`items/weapons.ts`
- **怪物**：`monsters/templates.ts`、`monsters/early-game.ts`
- **成长与生产**：`skills.ts`、`recipes.ts`、`resource-nodes.ts`、`upgrades.ts`
- **世界内容**：`combat-zones.ts`、`dungeons.ts`、`locations.ts`
- **开局职业**：`heroes.ts`
- **默认内容装配**：`build-default-content.ts`

## 关键约定

- **ID 命名**：统一使用点分命名空间，例如 `item.weapon.copper_sword`
- **作者层可以继承，运行时不可以**：继承只是 `src/content` 内部的 authoring 语法糖，不进入 `ContentDb` 语义
- **内容保持纯数据**：大部分定义只保存静态数据；`TalentDef` / `EffectDef` 允许携带函数，但它们依然属于内容层定义，不持有运行时实例
- **起始自动装备**：`session.resetToFresh()` 在发放起始物品后会自动装备背包内的 gear，确保新档一开局就有装备

## 边界

- **不负责运行时实例**：`GearInstance`、actor、battle、activity 都不在 content 层创建
- **不负责业务流程**：装备、合成、采集、战斗等命令由各自模块执行，content 只提供静态定义
- **不负责 UI 状态**：界面只消费定义，不回写 `ContentDb`
- **不让运行时理解模板**：`setContent()` 之后的注册表里不应出现模板节点或 `extends` 元数据

## 入口

- **运行时类型**：`src/core/content/types.ts`
- **注册表**：`src/core/content/registry.ts`
- **默认内容 facade**：`src/content/index.ts`
- **作者层继承编译器**：`src/content/compiler/inheritance.ts`
- **默认内容模块**：`src/content/default/`

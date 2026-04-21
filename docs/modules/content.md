# content

静态内容的类型定义与注册表。运行时的各个模块都通过字符串 ID 引用内容，再从 `ContentDb` 中查表。

## 职责

- 定义内容类型：`ItemDef`、`MonsterDef`、`AbilityDef`、`EffectDef`、`SkillDef`、`StageDef`、`ResourceNodeDef`、`UpgradeDef`、`AttrDef`、`TalentDef`、`RecipeDef`
- 提供 `ContentDb` 聚合视图与 `emptyContentDb()` 工厂
- 承载 `StartingConfig`，即新游戏的起始英雄与初始 stage 配置

## 边界

- 不负责运行时实例，例如 `GearInstance`、actor 等对象都由对应模块创建
- 内容定义保持只读、可序列化；运行时需要派生的字段由其他模块按需组装

## 约定

- ID 使用点分命名空间；改名就意味着需要迁移
- 每种内容类型都放在 `ContentDb` 的对应字段中
- 测试可以通过 `emptyContentDb()` 只组装所需的最小内容子集

## 入口

- 类型定义：`src/core/content/types.ts`
- 默认内容：`src/content/index.ts`

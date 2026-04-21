# content

静态内容的类型定义与注册表。所有模块通过字符串 ID 引用内容，运行时从 `ContentDb` 查表。

## 职责

- 定义内容类型：`ItemDef` / `MonsterDef` / `AbilityDef` / `EffectDef` / `SkillDef` / `StageDef` / `ResourceNodeDef` / `UpgradeDef` / `AttrDef` / `TalentDef` / `RecipeDef`。
- 提供 `ContentDb` 聚合视图与 `emptyContentDb()` 工厂。
- 承载 `StartingConfig`：新游戏的起始英雄与落地 stage。

## 边界

- 不承担内容的运行时实例（`GearInstance`、actor 等由对应模块创建）。
- 定义是只读的 plain data；运行时需要派生的字段（如 ability 列表）由 actor 层按需组装。

## 约定

- ID 点分命名空间，改名即迁移。
- 分支品类统一放 `ContentDb` 对应槽，测试可用 `emptyContentDb()` 组合最小子集。

入口：`src/core/content/types.ts`；默认内容：`src/content/index.ts`。

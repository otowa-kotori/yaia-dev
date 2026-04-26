# 架构

本文说明项目的顶层分层、依赖方向和跨模块约定。各模块的内部契约见 `docs/modules/`；偏设计目标而非当前实现的内容，见 `docs/design/`。

## 分层

```text
UI (React)                    负责展示与交互；读取 revision；调用 session 指令
      │
      ▼
Store (src/ui/store.ts)       负责订阅、revision bump、存档节流
                              在运行时把这些能力附加到 session 实例上，
                              因此 UI 可以直接调用 GameSession 暴露的指令
      │
      ▼
GameSession (core/session)    负责运行时编排：tick 引擎、事件总线、rng、
                              GameState、stage controller、activity
      │
      ▼
Game Core 各模块              负责数据结构与游戏规则
```

Store 层只负责订阅与存档，不承载游戏规则。新游戏初始化也属于 session 或更下层的职责。

统一玩家日志由 `core/infra/game-log/` 通过 typed event bus 收集到 `GameState.gameLog`；Store 只监听 `gameLogAppended` 做刷新与及时持久化，不直接拼日志文案。

新增游戏指令时，优先加在 `GameSession` 上；UI 直接调用，不需要额外转发层。

## 模块地图

| 分组 | 目录 | 模块 | 职责 | 文档 |
|---|---|---|---|---|
| 基础设施 | `infra/` | `tick` `rng` `events` `formula` `state` `game-log` | 时间、确定性随机、事件总线、命名公式、根状态、统一玩家日志收集 | [infrastructure](./modules/infrastructure.md) |
| 内容 | — | `content` | 静态定义注册表与 ID 命名空间 | [content](./modules/content.md) |
| 实体 | `entity/` | `actor` `attribute` | Actor 层级、工厂、ATTR 常量与 modifier / dynamic provider 堆叠 | [actor](./modules/actor.md) · [attribute](./modules/attribute.md) |
| 物品 | — | `item` `inventory` | `GearInstance` 创建与固定位置网格背包 | [item-inventory](./modules/item-inventory.md) |
| 行为 | `behavior/` | `effect` `ability` | 通用效果结算与 talent 施放管线。注意：目录历史名仍是 `ability`，但语义已经切到 `TalentDef / tryUseTalent` | [effect-ability](./modules/effect-ability.md) |
| 战斗 | `combat/` | `battle` `intent` `reaction` | 战斗状态、ATB 调度、自动决策、反应钩子与胜负推进 | [combat](./modules/combat.md) |
| 场景 | `world/` | `stage` `activity` | Location / Entry / Stage 三层模型与玩家活动 | [stage-activity](./modules/stage-activity.md) |
| 成长 | `growth/` | `leveling` `talent` `worldrecord` `upgrade-manager` | XP / Level、天赋点分配、全局进度、升级购买 | [progression](./modules/progression.md) |
| 编排 | — | `session` | `GameSession` 运行时聚合层 | [session](./modules/session.md) |
| 持久化 | — | `save` | 序列化、迁移、存档适配器 | [save](./modules/save.md) |

## 依赖方向

```text
UI → Store → GameSession → Core 各模块
```

依赖只能单向向下：

- UI 依赖 Store
- Store 依赖 `GameSession`
- `GameSession` 可以调用任意 core 模块
- `save` 可以单向读取 content 注册表以补回派生字段
- 其余 core 模块之间不得反向依赖

## 跨模块约定

- **时间单位**：Core 内部统一使用 logic tick（10 Hz）；毫秒只出现在 UI 边界
- **确定性**：所有 gameplay 随机都必须走 `ctx.rng`，禁止直接使用 `Math.random()`
- **序列化**：`GameState` 及其子字段必须能进行 JSON 往返；派生字段只存在于内存中，读档时重建
- **Alpha 策略**：不提供兜底逻辑；缺少必要内容时直接抛出异常
- **ID 命名**：使用点分命名空间，例如 `talent.basic.attack`、`item.ore.copper`
- **注释策略**：重构时保留原注释；如果注释过时，就更新或显式标注原因
- **文档分层**：`docs/modules/` 写当前实现契约；`docs/design/` 可以领先实现，但必须显式标注“已落地 / 未落地”

## 启动流程

1. UI 调用 `createGameStore({ content })`，内部创建 `GameSession`
2. Store 挂载 `__ui_notifier` Tickable 与 bus 监听，用于 revision bump 和存档调度；其中 `gameLogAppended` 会立即触发 UI 刷新与及时持久化
3. 自动加载时：如果已有存档，则调用 `session.loadFromSave`；否则调用 `session.resetToFresh`，并读取 `ContentDb.starting` 初始化新游戏

新游戏初始化完全由内容配置驱动：起始英雄与初始 location 都写在 `ContentDb.starting` 中。未配置时直接抛出异常，不做兜底。

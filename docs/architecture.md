# 架构

顶层分层、依赖方向、跨模块约定。模块内部契约见 `docs/modules/`，实现细节在源码注释。

## 分层

```
UI (React)                    组件；读 revision，下达 session 指令
      │
      ▼
Store (src/ui/store.ts)       订阅调度 + 存档节流
                              通过 Object.assign 把自己的方法混入 session，
                              GameStore IS-A GameSession
      │
      ▼
GameSession (core/session)    运行时编排：引擎、bus、rng、state、
                              stage controller、activity
      │
      ▼
Game Core 各模块              数据与规则（见下方依赖图）
```

Store 层只做订阅 + 存档。游戏规则（含新游戏初始化）全部在 session 或更下层。新增指令 = 在 `GameSession` 上加方法，UI 立即可调用，无需转发。

## 模块地图

| 分组 | 模块 | 职责 | 文档 |
|---|---|---|---|
| 基础设施 | `tick` `rng` `events` `formula` `state` | 时间、确定性随机、事件总线、命名公式、根状态 | [infrastructure](./modules/infrastructure.md) |
| 内容 | `content` | 静态定义注册表与 ID 命名空间 | [content](./modules/content.md) |
| 数值 | `attribute` | ATTR 常量与 Modifier 堆叠 | [attribute](./modules/attribute.md) |
| 物品 | `item` `inventory` | GearInstance 创生与固定位置网格背包 | [item-inventory](./modules/item-inventory.md) |
| 实体 | `actor` | Actor 层级、工厂、派生字段重建 | [actor](./modules/actor.md) |
| 行为 | `effect` `ability` `intent` `combat` | GAS 风管线与战斗调度 | [effect-ability-combat](./modules/effect-ability-combat.md) |
| 场景 | `stage` `activity` | 场景 actor 生命周期与玩家活动 | [stage-activity](./modules/stage-activity.md) |
| 进度 | `progression` `worldrecord` `upgrade-manager` | XP / Level、全局进度、升级购买 | [progression](./modules/progression.md) |
| 编排 | `session` | GameSession 运行时聚合 | [session](./modules/session.md) |
| 持久化 | `save` | 序列化、迁移、存档适配器 | [save](./modules/save.md) |

## 依赖方向

```
UI → Store → GameSession → Core 各模块
```

不得反向依赖。`session` 可调用下方任意 core 模块；`save` 可单向引用 content 注册表；其余模块间只能从下往上被引用。

## 跨模块约定

- **时间**：Core 内部一律 tick（10 Hz）；ms 只出现在 UI 边界。
- **确定性**：gameplay 随机全部走 `ctx.rng`，禁用 `Math.random()`。
- **序列化**：`GameState` 及其下所有字段必须 JSON 可往返；派生字段在内存里，存档剥离、读档重建。
- **Alpha 策略**：不做 fallback，缺内容直接抛异常。
- **ID 命名**：点分命名空间（`ability.fire.fireball`、`item.ore.copper`）；改名即迁移。
- **注释**：重构时保留原注释，过时则更新或显式标注。

## 启动流程

1. UI 调 `createGameStore({ content })`，内部构造 `GameSession`。
2. Store 挂 `__ui_notifier` Tickable 与 bus 监听，触发 revision bump 与存档调度。
3. 自动加载：有存档走 `session.loadFromSave`；无存档走 `session.resetToFresh`（读 `ContentDb.starting`）。

新游戏 bootstrap 由内容驱动——起始英雄与落地 stage 写在 `ContentDb.starting`。没配就抛，不兜底。

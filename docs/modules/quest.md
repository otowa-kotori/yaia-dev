# quest

事件驱动的任务系统。支持进度追踪、多种完成条件、奖励发放、隐藏任务、自动接取/提交、交付语义、可重复任务、全局/角色作用域。

## 定位

任务系统是一个**跨系统协调者**——自身不持有复杂的 tick 逻辑，而是通过监听 EventBus 被动推进，通过调用 economy/unlock/flags 等模块产出副作用。

## 状态机

```text
(无实例) ──(前置满足)──→ available ──(接取/自动接取)──→ active ──(目标全满)──→ ready ──(交付/自动交付)──→ completed
                              ↑                            │                                                    │
                              └─────────(abandon)──────────┘                                                    │
                              ↑                                                                                 │
                              └─────────────────────────(repeatable: 重置)──────────────────────────────────────┘
```

- `available` 不持久化——由 QuestTracker 实时计算
- `active` / `ready` / `completed` 存入 `GameState.quests`
- `turnIn.mode: "auto"` 时，`ready` 只是一个瞬态，同 tick 完成

## 核心类型

### QuestCondition — 状态断言原语

用于任务前置条件和状态型目标：

| type | 语义 |
|------|------|
| `questCompleted` | 指定任务已完成 |
| `playerLevel` | 任意英雄等级 ≥ min |
| `isUnlocked` | 指定 unlock 已解锁 |
| `hasFlag` | flags 中指定 key 的值满足条件 |
| `hasItem` | 背包中持有指定物品 ≥ qty |
| `hasCurrency` | 持有货币 ≥ amount |

### QuestObjectiveDef — 目标定义

两种类型：

- **event**：事件累加器。监听 bus 事件，通过 `filter` 匹配 payload，累积 `progress` 直到 `targetCount`。支持 `incrementField` 从 payload 取增量值。
- **state**：状态检查。复用 `QuestCondition`，在相关事件触发时重新评估。`progress` 为 0 或 1。

### ObjectiveFilter — 事件过滤器

递归结构：`{ field, op, value }` 叶节点 + `{ all: [...] }` / `{ any: [...] }` 组合节点。

### GameAction — 统一副作用原语

替代旧的 `DialogueAction`（后者现在是 `GameAction` 的类型别名）。对话系统和任务系统共享同一套 action 类型和执行器。

| type | 效果 |
|------|------|
| `setFlag` | 写 `GameState.flags` |
| `unlock` | 调用 unlock 模块 + 触发事件 |
| `grantReward` | 向当前聚焦角色发放 RewardBundle |
| `startQuest` | 接取指定任务 |
| `turnInQuest` | 提交指定任务 |

### QuestTurnIn — 交付配置

- `mode: "auto"` — 目标达成后立即完成（默认）
- `mode: "manual"` — 玩家在 UI 或对话中手动提交
- `cost?: CostDef` — 交付时扣除的物品/货币

NPC 交付的实现方式：在对话中添加 `{ type: "turnInQuest", questId }` 的 action 节点。

### QuestDef — 内容定义

QuestDef 是 ContentDb 的一等公民，通过 `getQuest(id)` 查表。支持：

- `hidden` / `autoAccept`
- `prerequisites?: QuestCondition[]`（AND 语义）
- `objectives: QuestObjectiveDef[]`（全部满足才算完成）
- `turnIn?: QuestTurnIn`
- `rewards?: RewardBundle`
- `onComplete?: GameAction[]`
- `scope?: "global" | "character"`
- `repeatable?: boolean | { cooldownTicks?: number }`

## 运行时架构

### QuestTracker

纯事件驱动，不是 Tickable。在 `createSessionRuntime` 时创建并 `attach()` 到 bus。

- **attach()** 为所有可能相关的事件类型注册 listener，返回清理函数
- **事件回调流程**：匹配 filter → 增量 progress → 检查是否所有 objectives 满足 → 若满足且 auto → 完成
- **reeval()** 在 loadFromSave / resetToFresh 后调用，重新评估 state objectives + autoAccept

### reevalOn 自动推导

`deriveReevalEvents(condition)` 根据 QuestCondition 类型自动推导需要监听的事件，不需要内容作者手动配置。

## 持久化

- `GameState.quests: Record<string, QuestInstance>` — key 为 questId
- QuestInstance 是纯数据，无派生字段，直接 JSON 序列化
- `available` 状态不持久化，由 QuestTracker 在运行时计算

## 事件

| 事件 | 说明 |
|------|------|
| `questAccepted` | 接取任务 |
| `questProgress` | 目标进度更新（含 objectiveIndex、current、target） |
| `questReady` | 所有目标满足，等待提交 |
| `questCompleted` | 任务完成 |
| `questAbandoned` | 放弃任务 |

`questCompleted` 可被其他任务的 event-objective 监听（如"完成 3 个支线任务"）。

## Session 接口

```typescript
session.acceptQuest(questId): void
session.abandonQuest(questId): void
session.turnInQuest(questId): void
session.getAvailableQuests(): string[]
session.getActiveQuests(): QuestInstance[]
session.getQuestInstance(questId): QuestInstance | undefined
session.debugForceCompleteQuest(questId): void
```

## 调试界面

DebugPanel 中新增 "任务" 区块：可接取/进行中/可提交/已完成列表，支持接取、放弃、提交、强制完成、展开查看原始 JSON。

## 边界

- 不负责 NPC 对话触发——对话系统通过 `GameAction.startQuest` / `GameAction.turnInQuest` 间接操作
- 不负责 UI 展示——UI 通过 session 方法获取数据
- 不是 Tickable，零 tick 开销
- 不做回溯计算——进度从接取时刻的 0 开始

## 入口

- `src/core/quest/conditions.ts` — 条件评估 + reevalOn 推导
- `src/core/quest/filters.ts` — 事件过滤器匹配
- `src/core/quest/tracker.ts` — QuestTracker 生命周期管理
- `src/core/quest/index.ts` — 重导出
- `src/core/session/gameplay/quest.ts` — session 层封装
- `src/core/content/types.ts` — QuestDef、QuestCondition、GameAction 等类型定义
- `src/core/infra/state/types.ts` — QuestInstance、QuestStatus
- `src/content/default/quests.ts` — 默认任务定义

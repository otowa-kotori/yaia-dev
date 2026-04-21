# 架构

本文档描述 YAIA（Yet Another Idle Adventure）的整体结构。实现细节与单个模块 API 到源码里看注释。

## 分层

```
UI (React)                   —— 组件；读 revision，下达 session 指令
       │
       ▼
Store (src/ui/store.ts)      —— 订阅 / 存档调度；通过 Object.assign
                                把自己的几个额外方法混入 session，
                                因此 GameStore IS-A GameSession
       │
       ▼
GameSession (src/core/session) —— 运行时编排：拥有 tick 引擎、bus、rng、
                                  state、stage controller、activity
       │
       ▼
Game Core 基础模块
  ├─ 基础设施：tick 引擎、rng、事件总线、content 注册表、公式、存档
  ├─ 数值层：Attribute + Modifier 堆叠、Ability / Effect (GAS 风)
  ├─ 实体层：Actor 层级、Stage session
  ├─ 行为层：Combat + Intent / Scheduler、Activity
  └─ 进度层：XP / Level
```

`Store` 层只做两件事：Reactive 订阅 + 存档节流。所有游戏规则（包括新游戏
初始化）都在 session 或更深层。加新指令 = 在 `GameSession` 上加方法，UI
立刻可以 `s.xxx()` 调用 —— store 无需转发。

## 关键概念

### Actor 层级（接口继承，非 class）

```
Actor                     任何世界实体
├─ Character              有 HP/MP/attrs/abilities 的生物
│   ├─ PlayerCharacter    level / xpCurve / equipped / skills / activity
│   └─ Enemy              defId → MonsterDef
└─ ResourceNode           可采集对象（矿/树/鱼点），无战斗属性
```

所有 Actor 住在 `GameState.actors[]`，plain data 可序列化。`attrs.modifiers`、`attrs.cache`、运行时 abilities 列表是派生字段，存档时剥离，读档时 `rebuildCharacterDerived` 从 equipped + activeEffects + knownAbilities 重建。

### 时间

内部一律 tick，ms 只在 UI 边界出现。TickEngine 10 Hz。注册顺序即执行顺序。

### Stage（关卡）

场景管理器，拥有自己的一系列 Actor。`StageController` 是 Tickable，负责 spawn / respawn / leave 时的清理。`state.currentStage` 是当前 session（stageId + spawnedActorIds + wave 计数）。同一时刻只能在一个 stage。

Stage **不管战斗流程**——它只管 actor 生命周期。

### 背包与装备

物品两类：

- **Stackable**（材料）：`{ itemId, qty }`，同 id 合并到一格。
- **Gear**（装备）：`GearInstance { instanceId, itemId, rolledMods }`。所有 gear 必经 `core/item/createGearInstance(itemId, { rng })` —— 掉落 / 合成 / dev 共用这一个出生口子，`ItemDef.roll` 声明词缀范围，roll 走 `ctx.rng` 保证可重放。

`ItemDef.modifiers` 是基线，`rolledMods` 是 per-instance 加成，两者在 `rebuildCharacterDerived` 合并，`sourceId` 带 `instanceId` 便于精准撤销。

背包是固定位置网格：`Inventory { capacity, slots: (StackEntry | GearEntry | null)[] }`，索引稳定（空格 = null），stack 和 gear 可在同一包混放。`state.inventories` 以 `charId` 或 `"shared"` 分包。

装备直接内联在 `PlayerCharacter.equipped: Record<slot, GearInstance | null>` —— 单一所有权：要么在 bag，要么在身上，不引用独立 instance 表。

### Activity（活动）

玩家在当前 stage 做的事。是 Tickable，挂在引擎上。

- `CombatActivity`：状态机 `waitingForEnemies → fighting → recovering → stopped`。只从 `state.currentStage` 读活 enemy，开 Battle。每次 phase 切换都会把自己镜像到 `hero.activity`（single writer，避免 store 代写造成的存档漂移）；`onStart` 钩子负责战斗前的 HP/MP 重置 + 清 effects/cooldowns，resume 路径跳过。
- `GatherActivity`：绑定 nodeId，每 swingTicks 发一轮奖励；同样在每次 swing 后自同步 `hero.activity`。

活动持久化形态是 `PlayerCharacter.activity`（kind + data），读档时 session 用 data 重新实例化 runtime Tickable。

### Battle（战斗）

Plain data，住 `state.battles[]`，可 JSON 序列化。

- `scheduler: SchedulerState` 是数据（不是 class），dispatcher 是 `nextActor()` 自由函数。SpeedSortedScheduler 每次 pick 时重新按 speed 排序从「本轮未行动者」里挑，buff 能即时生效。
- `intents: Record<actorId, intentId>` 是字符串；`resolveIntent(id)` 到注册表里查函数。
- 战斗按 `actionDelayTicks` 推进节奏；headless 和实时一致。
- 胜负由 `tickBattle` 判定，kill 通过 bus 的 `kill` 事件广播；奖励由监听者（如 CombatActivity）走 `applyEffect(synthesizedInstantEffect)` 发放，与 loot / XP / buff 共用一条管线。

### Ability / Effect（GAS 风）

- Ability 校验 cost / cooldown / target，成功后循环 apply 每个 Effect。
- Effect 三种 kind：
  - **instant**：立即结算，可带 formula + rewards
  - **duration**：安装 modifier + ActiveEffect，到期撤销
  - **periodic**：duration + 每 period tick 触发一次 instant 分支
- 所有「造成伤害、回血、给 XP / items、挂 buff」都走这一条路径。

### Modifier 堆叠

```
final = (base + Σflat) × (1 + Σpct_add) × Π(1 + pct_mult) → clamp → integer
```

sourceId 带回溯路径，装备卸下或 buff 到期时按 sourceId 清除。默认用 `pct_add`；`pct_mult` 留给稀有套装效果。

### 公式

命名公式 + 参数，如 `{ kind: "exp_curve_v1", base: 100, growth: 1.1 }`。`evalFormula` 用 switch 分派。字符串 parser 接口预留，MVP 不实现。

### ID 命名

点分命名空间（`ability.fire.fireball`、`item.ore.copper`、`skill.mining`）。改名 = 迁移事件。

### 存档

SaveAdapter 抽象（默认 LocalStorage，Node 环境自动降级到内存）。

- `serialize`：深拷贝 + 剥派生字段
- `deserialize`：走 version migrations → 给 Enemy 填回 `MonsterDef.abilities` → `rebuildCharacterDerived`
- Store 层：10 s 节流自动存 + 重要事件（levelup / stop / activityComplete / beforeunload）立即存
- 新游戏 bootstrap：`GameSession.resetToFresh` 读 `ContentDb.starting`（起始英雄配置 + `initialStageId`）。没配 `starting` 就抛异常，不 fallback。

## 依赖方向

```
UI → Store → GameSession → Core
                          ├─ tick, rng, events        （底层，无依赖）
                          ├─ content, formula         （内容定义 + 求值）
                          ├─ attribute                （ATTR 常量 + 堆叠）
                          ├─ item, inventory          （GearInstance + 固定位置网格）
                          ├─ actor                    （类型 + factory + 派生重建）
                          ├─ effect, ability          （GAS 管线）
                          ├─ intent, combat           （scheduler + battle）
                          ├─ stage                    （spawn/leave 控制器）
                          ├─ activity                 （combat / gather）
                          ├─ progression              （XP / Level）
                          └─ save                     （serialize / adapter / migrations）
```

不得反向依赖。`save` 模块允许 import content registry（单向）。`session` 住在 core 之内（`src/core/session`），向下调用 core，向上被 store 包装。

## 不变量

- Alpha 阶段不做 fallback；缺内容直接抛异常。
- Battle / actor / scheduler / intent map 必须 JSON 可序列化。
- 派生字段只在内存；存档时剥离，读档时重建。
- 所有 gameplay 随机走 `ctx.rng`；禁 `Math.random()`。
- 重构时保留原有注释。

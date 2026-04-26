# dungeon

副本（Dungeon）系统：多角色组队、固定顺序波次、一次性通关的战斗编排。

## 定位

它与 CombatZone（无限循环刷怪）并列，是第二种战斗模式：

- **CombatZone**：刷刷刷、无限循环、手动停
- **Dungeon**：固定波次、单次通关、失败或主动退出后结束

## 核心概念

```text
DungeonDef           — 副本的静态定义（固定波次序列、完成奖励、队伍限制）
DungeonSession       — 副本运行时状态，存在 GameState.dungeons[sessionId]
DungeonWorldActivity — WorldActivity，驱动副本 tick 推进
StageMode.dungeon    — StageSession 的 mode 联合体成员，标识 stage 归属副本
```

## 与 CombatZone 的区别

| | CombatZone | Dungeon |
|---|---|---|
| 波次选择 | 随机（从候选池中 pick） | 固定顺序（`waves[0]`, `waves[1]`, ...） |
| 循环 | 无限循环，手动 stopActivity | 有终点，最后一波胜利 = 通关 |
| 参与者 | 单人或组队，但本质是开放式循环刷怪 | 固定队伍一次性推进 |
| Battle mode | `solo` / `party` | `party` |
| 驱动 Activity | `CombatActivity` | `DungeonWorldActivity` |
| 波次搜索 | `StageController.pendingCombatWaveSearch` | 副本 activity 自己按固定波次直接 spawn |
| 波间恢复 | 搜敌阶段的临时恢复 + 死亡恢复 | 固定 `waveResting` 窗口，活人恢复、死人保持死亡 |

## 生命周期

```text
session.startDungeon(dungeonId, partyCharIds)
  → 保存每个角色的 locationId / stageId / activity 快照
  → 创建共享 StageSession（mode: { kind: "dungeon", dungeonSessionId }）
  → 创建 DungeonSession 写入 state.dungeons
  → 设置每个角色的 hero.dungeonSessionId
  → 创建并注册 DungeonWorldActivity

DungeonWorldActivity 状态机：
  spawningWave → fighting → waveCleared → waveResting → spawningWave → ...
                                      → completed（最后一波胜利）
                         → failed（团灭）
                         → abandoned（玩家主动退出）

终态（completed / failed / abandoned）→ restoreParty()
  → 恢复每个角色的 locationId
  → 清理 dungeon stage、DungeonWorldActivity、DungeonSession
```

## 状态机详解

- **spawningWave**
  - 立即刷出当前固定波次的敌人
  - 第一波没有额外预热；后续等待发生在 `waveResting`
  - 刷怪后立刻创建 party Battle，进入 `fighting`
- **fighting**
  - 每 tick 调用 `tickBattle()`
  - 战斗胜利 → `waveCleared`
  - 团灭 → `failed`
- **waveCleared**
  - 发放当前波次奖励
  - 清理旧 battle / 旧 wave 残留
  - 如果已经是最后一波：进入 `completed`
  - 否则：进入 `waveResting`
- **waveResting**
  - 固定的波间休整窗口
  - 存活角色会通过临时恢复 effect 回复一部分 HP / MP
  - 死亡角色在这个阶段不会自动复活
  - 计时结束后进入下一次 `spawningWave`
- **completed**
  - 发放 `completionRewards`
  - 触发 `dungeonCompleted`
  - 恢复角色并清理运行态
- **failed**
  - 触发 `dungeonFailed`
  - 恢复角色并清理运行态
- **abandoned**
  - 由 `session.abandonDungeon(charId)` 外部触发
  - 触发 `dungeonAbandoned`
  - 恢复角色并清理运行态

## 内容定义

```ts
interface DungeonDef {
  id: DungeonId;
  name: string;
  waves: DungeonWaveDef[];
  completionRewards?: WaveRewardDef;
  minPartySize?: number;
  maxPartySize?: number;
}
```

注意：

- `DungeonDef` **没有** `recoverBelowHpFactor`
- 波间恢复强度与持续时间当前来自运行时常量 `DUNGEON_RECOVERY_RULES`
- `LocationEntryDef` 通过 `{ kind: "dungeon"; dungeonId }` 指向副本入口

## 运行时状态

```ts
// GameState.dungeons[sessionId]
interface DungeonSession {
  dungeonId: string;
  partyCharIds: string[];
  savedActivities: Record<string, DungeonSavedCharState>;
  currentWaveIndex: number;
  status: "in_progress" | "completed" | "failed" | "abandoned";
  startedAtTick: number;
  stageId: string;
}

// PlayerCharacter
hero.dungeonSessionId: string | null;
```

## StageMode 联合类型

```ts
type StageMode =
  | { kind: "combatZone"; combatZoneId: string }
  | { kind: "gather" }
  | { kind: "dungeon"; dungeonSessionId: string };
```

StageSession 通过 `session.mode` 判断当前运行类型，代替旧的 `combatZoneId: string | null`。

## 事件

- `dungeonWaveCleared` —— 每波胜利后触发
- `dungeonCompleted` —— 通关触发
- `dungeonFailed` —— 团灭触发
- `dungeonAbandoned` —— 主动退出触发

## 当前已知边界

- `restoreParty()` 当前只恢复角色离开副本前的基础世界位置，不续接之前的 world activity
- 读档恢复采用保守策略：恢复到可安全继续的 phase，而不是精确回到某场 battle 的中间帧
- 副本波间恢复与 CombatZone 的 `searchingEnemies` / `deathRecovering` 不是同一套状态机

## 入口

- `src/core/world/activity/dungeon.ts`
- `src/core/infra/state/types.ts`（`DungeonSession`）
- `src/core/content/types.ts`（`DungeonDef`）
- `src/core/session/index.ts`（`startDungeon` / `abandonDungeon`）
- `tests/core/dungeon.test.ts`

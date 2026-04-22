# dungeon

副本（Dungeon）系统：多角色组队、固定顺序波次、一次性通关的战斗编排。

## 定位

与 CombatZone（无限随机循环刷怪）并列的第二种战斗模式。CombatZone 是"刷刷刷"，Dungeon 是"闯关"。

## 核心概念

```
DungeonDef         — 副本的静态定义（固定波次序列、奖励、队伍限制）
DungeonSession     — 副本运行时状态，存在 GameState.dungeons[sessionId]
DungeonWorldActivity — WorldActivity，驱动副本 tick 推进
StageMode.dungeon  — StageSession 的 mode 联合体成员，标识 stage 归属副本
```

## 与 CombatZone 的区别

| | CombatZone | Dungeon |
|---|---|---|
| 波次选择 | 随机（从候选池中 pick） | 固定顺序（waves[0], waves[1], ...） |
| 循环 | 无限循环，手动 stopActivity | 有终点，最后一波胜利 = 通关 |
| 参与者 | 单角色（per-character CombatActivity） | 多角色组队（WorldActivity 驱动） |
| Battle mode | solo | party（多 player participantIds） |
| 驱动 Activity | CombatActivity（CharacterActivity） | DungeonWorldActivity（WorldActivity） |
| 波次搜索 | StageController 的 pendingCombatWaveSearch | DungeonWorldActivity 直接 spawn |

## 生命周期

```
session.startDungeon(dungeonId, partyCharIds)
  → 保存每个角色的 locationId/stageId/activity 快照
  → 创建共享 StageSession（mode: { kind: "dungeon", dungeonSessionId }）
  → 创建 DungeonSession 写入 state.dungeons
  → 设置每个角色的 hero.dungeonSessionId
  → 创建并注册 DungeonWorldActivity

DungeonWorldActivity 状态机：
  spawningWave → fighting → waveCleared → recovering → spawningWave → ...
                                       → completed（最后一波胜利）
                          → failed（团灭）
                          → abandoned（玩家主动退出）

终态（completed/failed/abandoned）→ restoreParty()
  → 恢复每个角色的 locationId（activity/stageId 清空，角色回到闲置）
  → 清理 dungeon stage、DungeonWorldActivity、DungeonSession
```

## 状态机详解

- **spawningWave**：等待 `waveTransitionTicks` 后 spawn 当前波次的敌人，然后创建 party Battle
- **fighting**：每 tick 调用 `tickBattle`。战斗胜利 → waveCleared；团灭 → failed
- **waveCleared**：发放波次奖励，清理死亡敌人。如果还有下一波且 party 需要回血 → recovering；否则 → spawningWave。如果是最后一波 → completed
- **recovering**：每 tick 按 `recoverHpPctPerTick` 回血，全员满血后 → spawningWave
- **completed**：发放通关奖励，emit `dungeonCompleted`，恢复角色
- **failed**：emit `dungeonFailed`，恢复角色（不发通关奖励）
- **abandoned**：由 `session.abandonDungeon(charId)` 外部触发，emit `dungeonAbandoned`，恢复角色（不发通关奖励）

## 内容定义

```ts
interface DungeonDef {
  id: DungeonId;
  name: string;
  waves: DungeonWaveDef[];       // 固定顺序
  recoverBelowHpFactor: number;  // HP 低于此比例触发波间回血
  waveTransitionTicks: number;   // 波间等待 tick 数
  completionRewards?: WaveRewardDef;
  minPartySize?: number;
  maxPartySize?: number;
}
```

注册在 `ContentDb.dungeons`，通过 `getDungeon(id)` 查找。
`LocationEntryDef` 新增 `{ kind: "dungeon"; dungeonId: DungeonId }` 变体。

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

- `dungeonWaveCleared` — 每波胜利后触发
- `dungeonCompleted` — 通关触发
- `dungeonFailed` — 团灭触发
- `dungeonAbandoned` — 主动退出触发

## 已知待办

- **UI 副本入口**：已改为先打开组选弹窗，再调用 `startDungeon(dungeonId, partyCharIds)` 进入副本。组选界面复用公共 `Modal` 与角色选择按钮组件。
- **UI 副本状态展示**：已提供专用状态面板，展示副本名称、波次进度、当前阶段、队伍成员、敌人列表与放弃副本入口。
- **角色恢复的活动续接**：`restoreParty` 当前只恢复 locationId，不续接之前的 activity（角色回到闲置状态）。后续可考虑完整恢复。
- **读档恢复粒度**：当前仍然采用保守恢复策略；副本世界活动读档后会从可安全继续的阶段恢复，而不是精确回到 battle 中间帧。


## 入口

- `src/core/activity/dungeon.ts`
- `src/core/state/types.ts`（DungeonSession）
- `src/core/content/types.ts`（DungeonDef）
- `src/core/session/index.ts`（startDungeon / abandonDungeon）
- `tests/core/dungeon.test.ts`

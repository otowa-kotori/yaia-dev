# stage / activity

场景与玩家活动。

## Stage

- 场景管理器，持有一组 actor。`StageController` 是 Tickable，负责 spawn / respawn / leave 清理。
- `state.currentStage` 记录当前 session（stageId + spawnedActorIds + wave 计数）。同一时刻只能在一个 stage。
- **只管 actor 生命周期**，不管战斗流程。

## Activity

玩家在当前 stage 做的事，是 Tickable。

- `CombatActivity`：状态机 `waitingForEnemies → fighting → recovering → stopped`。只从 `state.currentStage` 读活 enemy，开 Battle。每次 phase 切换自同步到 `hero.activity`（single writer）；`onStart` 钩子负责战斗前 HP/MP 重置 + 清 effects / cooldowns，resume 路径跳过。
- `GatherActivity`：绑定 nodeId，每 swingTicks 发一轮奖励；同样在每次 swing 后自同步 `hero.activity`。

## 持久化

- Activity 的持久化形态是 `PlayerCharacter.activity`（kind + data），读档时 session 按 data 重新实例化 runtime Tickable。
- Activity 自己是 single writer：store 不代写 `hero.activity`，避免存档漂移。

## 边界

- stage 不读战斗状态；activity 不管 actor 生命周期。
- 编排由 `session` 负责（注册/注销 Tickable、发起/停止活动）。

入口：`src/core/stage/`、`src/core/activity/`。

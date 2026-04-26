# actor

Actor 模块定义世界中的实体层级、角色的持久化边界，以及读档/装备变化后如何重建派生状态。

## 层级

这里使用接口继承，不使用 class：

```text
Actor                      任何世界实体
├─ Character               有 HP / MP / attrs / effects / cooldowns / talents 的生物
│   ├─ PlayerCharacter     额外持有 level / exp / equipped / talentLevels / activity / heroConfigId
│   └─ Enemy               通过 defId 关联到 MonsterDef
└─ ResourceNode            可采集对象，例如矿点、树、鱼点；不参与战斗属性计算
```

所有 actor 都保存在 `GameState.actors[]` 中，并且必须保持为可序列化的纯数据。

## 持久化字段与派生字段

### 持久化字段

会进入存档的字段包括：

- `currentHp`、`currentMp`
- `activeEffects`、`cooldowns`
- `attrs.base`
- 各种 actor 自己的来源字段

其中：

- `PlayerCharacter` 会保存：
  - `level`、`exp`、`xpCurve`、`maxLevel`
  - `heroConfigId`
  - `skills`
  - `equipped`
  - `talentLevels`
  - `knownTalents`
  - `activity`
  - `locationId`、`stageId`、`dungeonSessionId`
  - `activeSustains`
  - `equippedTalents`
- `Enemy` 只保存 `defId`

### 派生字段（不进存档，读档后重建）

- `attrs.modifiers`：从装备、activeEffects、世界升级重新安装
- `attrs.dynamicProviders`：从 `heroConfigId` / `MonsterDef` 的 `physScaling`、`magScaling` 重新安装
- `attrs.depGraph`：从 `AttrDef.dependsOn` 与 dynamic providers 重建
- `attrs.cache`：全部标脏，lazy recompute
- `knownTalentIds`：
  - 玩家从 `knownTalents` 复制
  - 敌人从 `MonsterDef.talents` 补回
- `side`：战斗中的临时阵营信息

### 多角色相关字段

- `locationId: string | null` —— 角色当前所在地点；每个角色独立
- `stageId: string | null` —— 引用 `GameState.stages` 中的运行态实例；多个角色可共享同一个 `stageId`
- `dungeonSessionId: string | null` —— 引用 `GameState.dungeons` 中的副本运行态；多人副本共享

### 运行时 actor ID 约定

运行时生成的 `Enemy` / `ResourceNode` / `Stage` / `Battle` 都从 `GameState.runtimeIds.nextSeq` 这一条共享序列发号。典型形式如：

- `monster.slime.A1b2C`
- `node.iron_vein.Z9xY0`
- `stage.K3mP1`
- `battle.Q8rT4`

## rebuildCharacterDerived

`rebuildCharacterDerived(c, attrDefs, worldRecord?)` 是角色派生字段的唯一重建入口。它是幂等的，可以重复调用。

当前实现的顺序是：

1. 清空 `attrs.modifiers`、`attrs.dynamicProviders`、`attrs.depGraph`，并把 cache 全部标脏
2. 重新安装玩家装备带来的 modifiers
3. 重新安装世界升级 modifiers（仅玩家）
4. 重新安装 `activeEffects` 带来的 modifiers
5. 根据 `HeroConfig` / `MonsterDef` 安装 `PHYS_POTENCY`、`MAG_POTENCY` 的 dynamic providers
6. 重建 `knownTalentIds`
7. 重建 `depGraph`，并按新的 `MAX_HP` / `MAX_MP` 夹取当前 HP / MP

调用时机：

1. 读档后
2. 装备 / 卸装后
3. effect 应用 / 移除后（effect 管线自动调用）
4. 升级后
5. 世界升级变化后

## talent 相关约定

- `knownTalents` 是玩家已学会 talent 的**持久化真值**
- `knownTalentIds` 是运行时消费侧使用的**派生列表**
- `equippedTalents` 决定玩家当前可在战斗中主动使用哪些 active / sustain talent
- `activeSustains` 记录每个互斥组当前开启的 sustain
- 基础攻击不占 talent 槽，但仍然属于 `knownTalentIds`

## 类型守卫

需要做类型缩小时，优先使用共享守卫函数 `isPlayer()`、`isEnemy()`、`isCharacter()`，而不是直接比较 `kind` 字段。

## 入口

`src/core/entity/actor/`

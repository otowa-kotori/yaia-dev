# actor

Actor 模块定义世界中的实体层级，以及角色派生字段的重建规则。

## 层级

这里使用接口继承，不使用 class：

```text
Actor                      任何世界实体
├─ Character               有 HP / MP / attrs / abilities 的生物
│   ├─ PlayerCharacter     额外持有 level / xpCurve / equipped / skills / activity
│   └─ Enemy               通过 defId 关联到 MonsterDef
└─ ResourceNode            可采集对象，例如矿点、树、鱼点；不参与战斗属性计算
```

所有 actor 都保存在 `GameState.actors[]` 中，并且必须保持为可序列化的纯数据。

## 持久化字段与派生字段

### 持久化字段

会进入存档的字段包括：

- `currentHp`
- `currentMp`
- `activeEffects`
- `cooldowns`
- `attrs.base`
- 各种 actor 自己的来源字段

其中：

- `PlayerCharacter` 会保存 `level`、`exp`、`equipped`、`talents`、`knownAbilities`、`xpCurve`、`skills`、`locationId`、`stageId`
- `Enemy` 只保存 `defId`

**多角色相关字段**：

- `locationId: string | null` — 该角色当前所在地点。每个角色独立，支持多角色并行在不同地点挂机
- `stageId: string | null` — 引用 `GameState.stages` 中的 stage 实例。null 表示不在任何 stage。多个角色可以引用同一个 stageId（未来多人副本）

**运行时 actor ID 约定**：

- 运行时生成的 `Enemy` / `ResourceNode` 都从 `GameState.runtimeIds.nextSeq` 这一条共享序列发号。
- 完整 ID 只保留最小来源语义，不再拼入 location、wave、tick 等上下文。
- 典型形式是 `monster.slime.A1b2C`、`node.test_vein.Z9xY0`。

### 派生字段

以下内容不直接进入存档，而是在读档时重建：

- `attrs.modifiers`
- `attrs.cache`
- 运行时 ability 列表

读档时由 `rebuildCharacterDerived` 根据 `equipped`、`activeEffects` 和 `knownAbilities` 重建这些派生数据。

## 类型守卫

需要做类型缩小时，优先使用共享守卫函数，例如 `isPlayer()`，而不是直接比较 `kind` 字段。

## 入口

`src/core/actor/`

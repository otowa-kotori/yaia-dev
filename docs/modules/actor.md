# actor

Actor 模块定义世界中的实体层级，以及角色派生字段的重建规则。

## 层级

这里使用接口继承，不使用 class：

```text
Actor                      任何世界实体
├─ Character               有 HP / MP / attrs / abilities 的生物
│   ├─ PlayerCharacter     额外持有 level / xpCurve / equipped / skills / activity / heroConfigId
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

- `PlayerCharacter` 会保存 `level`、`exp`、`equipped`、`talents`、`knownAbilities`、`xpCurve`、`skills`、`locationId`、`stageId`、**`heroConfigId`**
- `Enemy` 只保存 `defId`

**`heroConfigId`**：指向 `ContentDb.starting.heroes` 里对应的 `HeroConfig.id`，运行时用于查找 `growth`、`physScaling`、`magScaling`。这三个字段属于内容层职责，**不持久化**到 PlayerCharacter 实例上。

**多角色相关字段**：

- `locationId: string | null` — 该角色当前所在地点，每个角色独立，支持多角色并行在不同地点挂机
- `stageId: string | null` — 引用 `GameState.stages` 中的 stage 实例，多个角色可引用同一个 stageId

**运行时 actor ID 约定**：

运行时生成的 `Enemy` / `ResourceNode` 都从 `GameState.runtimeIds.nextSeq` 这一条共享序列发号，典型形式是 `monster.slime.A1b2C`、`node.test_vein.Z9xY0`。

### 派生字段（不进存档，读档后重建）

- `attrs.modifiers`：从装备、activeEffects、世界升级重新安装
- `attrs.dynamicProviders`：从 `heroConfigId` 查得的 physScaling / magScaling 安装 DynamicModifierProvider，以及 activeEffects / 天赋（后续）
- `attrs.depGraph`：从 attrDefs + dynamicProviders 重建
- `attrs.cache`：全部标脏，lazy recompute
- `abilities`：从 `knownAbilities`（玩家）或 MonsterDef（Enemy）重建

## rebuildCharacterDerived

`rebuildCharacterDerived(c, attrDefs, worldRecord?)` 是派生字段的唯一重建入口，调用时机：

1. 读档后
2. 装备 / 卸装后
3. effect 应用 / 移除后（effect 管线自动调用）
4. 升级（grantCharacterXp 通知调用方再 rebuild）

安装顺序：`gear modifiers → world modifiers → effect modifiers → physScaling/magScaling providers`

## physScaling / magScaling

决定一级属性如何汇聚到 PHYS_POTENCY / MAG_POTENCY（进而影响 PATK / MATK）：

- **PlayerCharacter**：从 `ContentDb.starting.heroes.find(h => h.id === pc.heroConfigId)` 读取
- **Enemy**：从 MonsterDef 读取，默认 `[{STR, 1.0}]` / `[{INT, 1.0}]`

每次 rebuild 时全部清空再重新安装，天然幂等。

## 类型守卫

需要做类型缩小时，优先使用共享守卫函数 `isPlayer()`、`isEnemy()`、`isCharacter()`，而不是直接比较 `kind` 字段。

## 入口

`src/core/entity/actor/`

# actor

Actor 层级与派生字段重建。

## 层级（接口继承，非 class）

```
Actor                      任何世界实体
├─ Character               有 HP/MP/attrs/abilities 的生物
│   ├─ PlayerCharacter     level / xpCurve / equipped / skills / activity
│   └─ Enemy               defId → MonsterDef
└─ ResourceNode            可采集对象（矿/树/鱼点），无战斗属性
```

所有 actor 住在 `GameState.actors[]`，plain data 可序列化。

## 持久化 vs 派生

- **持久化字段**：currentHp / currentMp / activeEffects / cooldowns / attrs.base，以及每种 kind 的来源字段（level/exp/equipped/talents/knownAbilities/xpCurve/skills；Enemy 只有 defId）。
- **派生字段**：`attrs.modifiers` / `attrs.cache` / 运行时 ability 列表。存档剥离，读档由 `rebuildCharacterDerived` 从 equipped + activeEffects + knownAbilities 重建。

## 类型守卫

优先使用共享的 `isPlayer()` 等 guard，不直接比较 `kind` 字段。

入口：`src/core/actor/`。

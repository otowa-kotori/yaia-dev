# save

`save` 模块负责序列化、版本迁移和存档适配器。

## 管线

### serialize

- 深拷贝当前状态
- 只保留 source-of-truth 字段
- 对 `Character`：
  - 清空 `attrs.modifiers`
  - 清空 `attrs.cache`
  - 清空运行时 `knownTalentIds`
- 输出可持久化的 plain JSON

`save` 的目标边界是：装备、effect、内容表仍然是事实来源；读档后再重建派生状态，而不是把整套运行时缓存原样写回去。

### deserialize

- 先按 `version` 逐步执行 migration
- 再根据 content 定义补回需要重建的派生信息：
  - `Enemy.knownTalentIds = MonsterDef.talents`
  - `PlayerCharacter.knownTalentIds = knownTalents`
  - 旧档若没有 `equippedTalents`，会在这里补默认空数组
- 最后调用 `rebuildCharacterDerived` 重建角色派生字段
  - 玩家会额外注入 `state.worldRecord`
  - 敌人只需 `attrDefs`

反序列化完成后，结果交给 `session.loadFromSave` 接管。

## 适配器

- `SaveAdapter` 是统一抽象
- 默认实现是 `LocalStorageSaveAdapter`
- Node 环境下会自动降级到内存适配器
- IndexedDB 适配器的接口已经预留

## 调度

存档节流由 store 管理：

- 每 10 秒自动存一次
- `levelup`、`activityComplete`、`gameLogAppended`、`beforeunload` 等重要事件会立即 flush

## 约定

- `GameState` 必须能进行 JSON 往返
- `gameLog` 是持久化字段，按固定上限尾部保留最近记录，避免存档无限增长
- `save` 可以单向读取 content 注册表，用于补回派生字段
- 新游戏初始化不走 save 管线，而是由 `session.resetToFresh` 读取 `ContentDb.starting`

### Alpha 阶段策略

仓库当前仍保留 migration 机制，但产品策略是：

- 不主动为了 alpha 阶段频繁改 schema 去补复杂兜底
- 如果旧档缺少关键字段或版本无法升级，应直接报错并清档，而不是静默修补

### lastWallClockMs

- `GameState.lastWallClockMs` 记录每次存档时的真实时间戳（`Date.now()`）
- 在 `persistNow()` 中写入，在 `createEmptyState()` 中初始化
- 读档后用于计算离线时长，驱动 catch-up 追帧

## 入口

`src/core/save/`

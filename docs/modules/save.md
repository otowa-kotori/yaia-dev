# save

`save` 模块负责序列化、版本迁移和存档适配器。

## 管线

### serialize

- 深拷贝当前状态
- 剥离派生字段
- 输出可持久化的 plain JSON

### deserialize

- 先按 `version` 逐步执行 migration
- 再根据 content 定义补回需要重建的派生信息，例如给 `Enemy` 填回 `MonsterDef.abilities`
- 最后调用 `rebuildCharacterDerived` 重建角色派生字段

反序列化完成后，结果交给 `session.loadFromSave` 接管。

## 适配器

- `SaveAdapter` 是统一抽象
- 默认实现是 `LocalStorageSaveAdapter`
- Node 环境下会自动降级到内存适配器
- IndexedDB 适配器的接口已经预留

## 调度

存档节流由 store 管理：

- 每 10 秒自动存一次
- `levelup`、`activityComplete`、`beforeunload` 等重要事件会立即 flush

## 约定

- `GameState` 必须能进行 JSON 往返
- 新增持久化字段时，需要同步加入 migration
- `save` 允许单向读取 content 注册表，用于补回派生字段
- 新游戏初始化不走 save 管线，而是由 `session.resetToFresh` 读取 `ContentDb.starting`

## 入口

`src/core/save/`

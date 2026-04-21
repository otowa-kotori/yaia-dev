# save

序列化、版本迁移、存档适配器。

## 管线

- `serialize`：深拷贝 + 剥派生字段，输出 plain JSON。
- `deserialize`：按 version 逐步 migrate → 给 Enemy 填回 `MonsterDef.abilities` → `rebuildCharacterDerived`。
- 结果交给 `session.loadFromSave` 接管。

## 适配器

`SaveAdapter` 抽象：默认 `LocalStorageSaveAdapter`，Node 环境自动降级到内存。IndexedDB 适配器接口预留。

## 调度

存档节流由 store 管理：10 s 周期自动存，重要事件（levelup / activityComplete / beforeunload）立即 flush。

## 约定

- `GameState` 必须 JSON 可往返；新增字段即新增 migration。
- 允许单向引用 content 注册表，以填补派生字段。
- 新游戏 bootstrap 由 `session.resetToFresh` 读 `ContentDb.starting` 触发，不经 save 管线。

入口：`src/core/save/`。

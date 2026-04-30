# unlock

解锁系统。管理功能、地点、UI tab 等"开关式"内容的解锁状态。

## 定位

- **底层存储**：`GameState.flags["unlock." + unlockId]`，key 由 `toUnlockFlagKey()` 统一生成。unlock 是 flags 的一个**有语义的命名子集**，两者共用同一个 `Record<string, number>`。
- **静态注册**：每个 unlock 必须有对应的 `UnlockDef` 注册在 `ContentDb.unlocks` 中。`session.isUnlocked` / `session.unlock` 调用前都会通过 `getUnlock()` 校验 ID，未注册的 ID 直接抛出异常。
- **事件**：`session.unlock()` 成功时触发 `bus.emit("unlocked", { unlockId, source, tick })`，Store 层监听后触发 UI 刷新和存档。

## 与 flags 的区别

| | flags 裸读写 | unlock 模块 |
|---|---|---|
| key 格式 | 任意字符串 | 固定 `"unlock." + unlockId` |
| 静态注册 | 无 | 必须有 `UnlockDef` |
| 写入事件 | 无 | `bus.emit("unlocked", ...)` |
| 典型用途 | 对话标记、任务进度、教程状态 | 地点、功能、UI tab 开关 |

## UnlockDef

```typescript
interface UnlockDef {
  id: UnlockId;
  name: string;
  description?: string;
  /** true 表示新存档默认已解锁。 */
  defaultUnlocked?: boolean;
}
```

`defaultUnlocked: true` 的 unlock 会在 `resetToFresh` 时由 `lifecycle.ts` 写入 flags。

## Session 接口

```typescript
session.isUnlocked(unlockId): boolean   // 校验 ID + 读 flags
session.unlock(unlockId, source?): boolean  // 校验 ID + 写 flags + emit "unlocked"
session.listUnlocked(): string[]         // 列出所有已解锁的 unlockId
```

`source` 参数用于日志和调试（`"system"` / `"dialogue"` / `"quest"` 等），默认 `"system"`。

## 内容层定义位置

- `src/content/default/unlocks.ts` — 当前所有 UnlockDef 集中定义于此
- `src/ui/unlocks.ts` — UI 层的 tab 解锁映射（`TAB_UNLOCK_IDS`）

## 当前已注册的 unlock

| id | 说明 |
|----|------|
| `unlock.location.twilight` | 解锁暮色林地 |
| `unlock.location.mine.ironfang` | 解锁铁牙矿坑 |
| `unlock.location.boss.blackfang` | 解锁黑牙兽巢 |
| `unlock.location.training` | 解锁训练场 |
| `unlock.feature.tab.upgrades` | 解锁全局升级 tab |

## 边界

- unlock 只有"解锁 / 未解锁"两态（0 / 1），不支持多级状态。多级进度用裸 flags。
- 不提供"重新锁定"接口。如需重置，直接操作 `session.state.flags`（alpha 阶段）。
- `LocationEntryDef` 和 `LocationDef` 均可携带 `unlockId`，UI 层通过 `store.isUnlocked()` 控制入口的可见性。

## 入口

- `src/core/growth/unlock/index.ts` — 纯函数：`isUnlocked`、`unlock`、`listUnlocked`、`toUnlockFlagKey`
- `src/core/session/gameplay/progression.ts` — session 层封装（加 ID 校验 + 事件）
- `src/core/content/types.ts` — `UnlockDef`、`UnlockId`

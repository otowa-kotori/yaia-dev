# flags

`GameState.flags` 是游戏存档中的通用键值存储，用于记录任何不属于其他专用字段的轻量状态。

## 定位

- **存储位置**：`GameState.flags: Record<string, number>`，随存档自动持久化。
- **类型**：值为 `number`。布尔语义用 `0 / 1`，计数器用正整数，其余自由扩展。
- **命名约定**：使用点分命名空间，例如 `"talked.aldric"`、`"tutorial.step"`。
- **无静态注册**：flags 是裸读写，不需要提前在 ContentDb 注册。

## 使用场景

| 场景 | key 示例 | 说明 |
|------|----------|------|
| 对话已发生 | `"talked.aldric"` | 对话 action `setFlag` 写入，condition `hasFlag` 读取 |
| 教程步骤 | `"tutorial.step"` | 教程系统推进时写入 |
| 任务进度计数 | `"quest.xxx.kills"` | 任务系统递增，条件检查 |

## 重要约定

**unlock 模块也使用 flags 作为底层存储，key 格式固定为 `"unlock." + unlockId`。** 不要手动写 `"unlock."` 前缀的 key，应使用 unlock 模块的接口。详见 [unlock 模块文档](./unlock.md)。

## 直接读写（session 层）

flags 可以通过 `session.state.flags` 直接读写：

```typescript
// 写
session.state.flags["talked.aldric"] = 1;

// 读
const hasTalked = (session.state.flags["talked.aldric"] ?? 0) > 0;
```

对话 action executor（Store 层）也走这条路径：`{ type: "setFlag", flagId, value }` 直接写 `session.state.flags`。

## 边界

- flags 是纯数据，不触发任何事件（对比：unlock 写入时会 `bus.emit("unlocked", ...)`）。
- flags 不做任何 ID 校验，写入未知 key 不会报错。
- 存档迁移时如需重置某个 flag，直接删除该 key 或置 0。

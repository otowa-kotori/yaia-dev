# dialogue

NPC 对话系统的核心执行层与内容模型。

## 定位

对话系统是独立于 NPC 存在的内容层。`DialogueDef` 是 ContentDb 的一等公民，NPC 只是触发对话的一个入口。任务系统、地点触发等将来都可以直接传 `dialogueId` 给播放器，不需要依赖 NPC。

对话**没有时间推进**，不接 tick 引擎，完全由玩家的点击驱动。游戏在对话期间正常运行（战斗、采集继续跑）。

## 节点类型

| 节点 | 是否需要玩家交互 | 说明 |
|------|------|------|
| `say` | 是 | 一行台词，点"继续"推进到 `next` |
| `choice` | 是 | 展示选项列表，条件不满足的选项静默隐藏 |
| `condition` | 否（自动穿越） | 按序检查 branches，匹配第一个满足的；全不匹配走 `fallback` |
| `action` | 否（自动穿越） | 执行副作用列表后跳到 `next` |
| `end` | — | 终止节点，播放器自动关闭对话层 |

`resolveNode` 负责从任意节点出发，自动穿越所有 condition/action 节点，直到遇到需要玩家参与的节点。上限 256 步，超出时抛出异常（防止内容作者写出死循环）。

## DialogueCtx

在 `openDialogue` 时由 Store 层快照，整个对话期间不刷新：

```typescript
interface DialogueCtx {
  focused: PlayerCharacter;   // 触发对话的角色
  party:   PlayerCharacter[]; // 整队（含 focused）
  state:   GameState;         // 用于读 flags、level 等
}
```

条件默认针对 `focused`；需要检查全队时用 `partyAnyLevel` 类型。

## 条件类型（DialogueCondition）

| 类型 | 说明 |
|------|------|
| `hasFlag` | `flags[flagId] > 0`（可指定最低值） |
| `missingFlag` | `flags[flagId]` 为 0 或不存在 |
| `isUnlocked` | 通过 `toUnlockFlagKey` 转换后读 flags，与 unlock 模块语义对齐 |
| `playerLevel` | focused 角色等级在 `[min, max]` 范围内 |
| `partyAnyLevel` | 任意队员等级 ≥ min |
| `and` / `or` | 复合条件 |

## Action 类型（DialogueAction）

| 类型 | 效果 |
|------|------|
| `setFlag` | 写 `GameState.flags[flagId] = value`（默认 1） |
| `unlock` | 调用 `session.unlock()`，会触发 `unlocked` 事件 |
| `grantReward` | **Alpha 阶段暂不生效**，待 session 暴露统一发放接口后接入 |
| `startQuest` | 占位，任务系统未落地前 no-op |

## flag vs unlock 的定位

两者都存储在 `GameState.flags`，区别在语义和接口层（详见 [flags.md](./flags.md) 和 [unlock.md](./unlock.md)）：

- **flags 裸读写**：对话内部状态（如 `"talked.aldric"`）、任务进度计数器等轻量标记。无静态注册，无事件。
- **unlock 模块**：`flags["unlock." + unlockId]`，有 `UnlockDef` 静态注册（`getUnlock()` 会校验 ID），unlock 时触发 `bus.emit("unlocked", ...)`。用于解锁地点、功能、UI tab 等有语义的开关。

对话 `action.setFlag` 写裸 flags，`action.unlock` 走 unlock 模块。条件 `isUnlocked` 内部也通过 `toUnlockFlagKey` 正确转换，与 unlock 模块保持一致。

## NPC

`NpcDef` 极简，只持有一个 `dialogueId` 引用：

```typescript
interface NpcDef {
  id: NpcId;
  name: string;
  dialogueId: DialogueId;
}
```

NPC 通过 `LocationEntryDef` 的 `kind: "npc"` 变体挂在地点下，点击后由 MapPanel 调用 `store.openDialogue(npc.dialogueId)`。

## Store 层接口

对话状态完全在 Store 层管理，不进入 GameSession：

```typescript
store.dialogueState          // DialoguePlayerState | null（普通可写属性）
store.openDialogue(id)       // 快照 ctx，解析入口节点
store.advanceDialogue(nodeId) // 推进到下一个可交互节点，end 时自动关闭
store.closeDialogue()        // 强制关闭
```

`dialogueState` 是普通属性（非 getter），由各方法直接赋值。不能用 `Object.assign` 里的 getter 语法——`Object.assign` 会展开求值导致始终返回 `null`。

## UI

`DialogueOverlay` 是全屏叠加层，层级关系：

| 层 | z-index |
|---|---|
| CatchUp overlay | z-[70]（最高，离线追帧完全接管） |
| DialogueOverlay | z-[55]（覆盖 MobileNav/Drawer，低于 CatchUp） |
| MobileNav | z-50 |
| Drawer | z-40 |

对话框宽度上限 `max-w-2xl`，`pb-20` 在手机端为遮住的底部导航留出视觉留白。

## 入口

- **执行器**：`src/core/dialogue/index.ts`
- **类型定义**：`src/core/content/types.ts`（DialogueDef、NpcDef、DialogueCondition、DialogueAction、DialogueNode）
- **注册表**：`src/core/content/registry.ts`（getDialogue、getNpc）
- **UI 组件**：`src/ui/components/DialogueOverlay.tsx`
- **示例内容**：`src/content/default/npcs.ts`

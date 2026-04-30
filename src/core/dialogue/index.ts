// dialogue/index.ts — 对话系统执行器
//
// 职责：
//   - 评估 DialogueCondition（针对 DialogueCtx）
//   - 推进节点（resolveNextNode：从任意节点自动跳过 condition/action 节点，
//     直到遇到需要玩家交互的 say/choice/end 节点）
//   - 执行 DialogueAction 副作用（通过 ActionExecutor 回调解耦，
//     避免直接依赖 session）
//
// 不含任何 React / UI 依赖。
// 不含 tick / 时间推进逻辑。
//
// 典型调用流程（Store 层）：
//   1. openDialogue → 调用 buildInitialState 得到首个可交互节点快照
//   2. 玩家点击选项或"继续" → 调用 advanceFromNode 得到下一个快照
//   3. 快照 kind === "end" → 关闭对话层

import type { PlayerCharacter } from "../entity/actor/types";
import type { GameState } from "../infra/state/types";
import type {
  DialogueDef,
  DialogueNode,
  DialogueNodeSay,
  DialogueCondition,
  DialogueAction,
} from "../content/types";
import { toUnlockFlagKey } from "../growth/unlock";

// ---------- 对话上下文 ----------
//
// 不可变快照：在 openDialogue 时由 Store 层构建，整个对话期间不刷新。
// 条件检查和 action 执行都从这里读取角色状态。

export interface DialogueCtx {
  /** 当前聚焦角色（触发对话的那名角色）。 */
  focused: PlayerCharacter;
  /** 整队（包含 focused）。 */
  party: PlayerCharacter[];
  /** 整份游戏状态（用于读 flags、货币等）。 */
  state: GameState;
}

// ---------- 对话播放器状态 ----------
//
// 只存放"当前停在哪个节点"和"当前可见的选项列表"。
// Store 层把这份数据暴露给 UI。

export interface DialogueVisibleChoice {
  /** 选项文本。 */
  label: string;
  /** 选择后跳到的节点 id。 */
  next: string;
}

/** 当前节点是 say 或有 text 的 choice 时的可交互状态。 */
export interface DialogueStateSay {
  kind: "say";
  nodeId: string;
  speaker?: string;
  text: string;
  /** 下一节点 id（玩家点"继续"时使用）。 */
  next: string;
}

export interface DialogueStateChoice {
  kind: "choice";
  nodeId: string;
  speaker?: string;
  text?: string;
  choices: DialogueVisibleChoice[];
}

export interface DialogueStateEnd {
  kind: "end";
  nodeId: string;
}

export type DialoguePlayerState =
  | DialogueStateSay
  | DialogueStateChoice
  | DialogueStateEnd;

// ---------- Action 执行器回调 ----------
//
// Store 层实现此接口，把 action 类型映射到具体的 session 命令。
// 对话执行器本身不依赖任何运行时模块。

export interface DialogueActionExecutor {
  setFlag(flagId: string, value: number): void;
  unlock(unlockId: string): void;
  grantReward(reward: DialogueAction & { type: "grantReward" }): void;
  startQuest(questId: string): void;
  turnInQuest(questId: string): void;
}

// ---------- 条件评估 ----------

export function evaluateCondition(
  condition: DialogueCondition,
  ctx: DialogueCtx,
): boolean {
  switch (condition.type) {
    case "hasFlag": {
      const val = ctx.state.flags[condition.flagId] ?? 0;
      return condition.value !== undefined ? val >= condition.value : val > 0;
    }
    case "missingFlag": {
      const val = ctx.state.flags[condition.flagId] ?? 0;
      return val === 0;
    }
    case "isUnlocked": {
      // unlock 的运行时 key 格式是 "unlock." + unlockId，通过 toUnlockFlagKey 统一转换
      return (ctx.state.flags[toUnlockFlagKey(condition.unlockId)] ?? 0) > 0;
    }
    case "playerLevel": {
      const lv = ctx.focused.level;
      if (condition.min !== undefined && lv < condition.min) return false;
      if (condition.max !== undefined && lv > condition.max) return false;
      return true;
    }
    case "partyAnyLevel": {
      return ctx.party.some((pc) => pc.level >= condition.min);
    }
    case "and": {
      return condition.conditions.every((c) => evaluateCondition(c, ctx));
    }
    case "or": {
      return condition.conditions.some((c) => evaluateCondition(c, ctx));
    }
  }
}

// ---------- Action 执行 ----------

function executeAction(
  action: DialogueAction,
  executor: DialogueActionExecutor,
): void {
  switch (action.type) {
    case "setFlag":
      executor.setFlag(action.flagId, action.value ?? 1);
      break;
    case "unlock":
      executor.unlock(action.unlockId);
      break;
    case "grantReward":
      executor.grantReward(action);
      break;
    case "startQuest":
      executor.startQuest(action.questId as string);
      break;
    case "turnInQuest":
      executor.turnInQuest(action.questId as string);
      break;
  }
}

// ---------- 节点解析 ----------
//
// resolveNode 从给定的节点 id 出发，自动穿越所有 condition/action 节点，
// 直到遇到需要玩家参与的节点（say / choice / end），返回其播放器状态。
//
// 防止无限循环：最多走 256 步，超出时抛出异常。

const MAX_STEPS = 256;

export function resolveNode(
  nodeId: string,
  dialogue: DialogueDef,
  ctx: DialogueCtx,
  executor: DialogueActionExecutor,
): DialoguePlayerState {
  let currentId = nodeId;
  let steps = 0;

  while (steps < MAX_STEPS) {
    steps++;
    const node = dialogue.nodes[currentId];
    if (!node) {
      throw new Error(`dialogue "${dialogue.id}": node "${currentId}" not found`);
    }

    switch (node.kind) {
      case "say":
        return buildSayState(node, currentId);

      case "choice": {
        const visible = node.choices.filter(
          (c) => !c.condition || evaluateCondition(c.condition, ctx),
        );
        // 所有选项都隐藏时视为无选项，直接视为"end"。
        // 这是一种安全兜底，内容作者应确保至少有一个选项可见。
        if (visible.length === 0) {
          return { kind: "end", nodeId: currentId };
        }
        return {
          kind: "choice",
          nodeId: currentId,
          speaker: node.speaker,
          text: node.text,
          choices: visible.map((c) => ({ label: c.label, next: c.next })),
        };
      }

      case "condition": {
        const matched = node.branches.find((b) =>
          evaluateCondition(b.condition, ctx),
        );
        currentId = matched ? matched.next : node.fallback;
        break; // 继续循环
      }

      case "action": {
        for (const action of node.actions) {
          executeAction(action, executor);
        }
        currentId = node.next;
        break; // 继续循环
      }

      case "end":
        return { kind: "end", nodeId: currentId };
    }
  }

  throw new Error(
    `dialogue "${dialogue.id}": exceeded ${MAX_STEPS} steps starting from "${nodeId}". Possible loop?`,
  );
}

// ---------- 进入对话 ----------

/** 从对话入口节点开始，返回第一个可交互状态。 */
export function buildInitialState(
  dialogue: DialogueDef,
  ctx: DialogueCtx,
  executor: DialogueActionExecutor,
): DialoguePlayerState {
  return resolveNode(dialogue.entry, dialogue, ctx, executor);
}

/** 玩家选择了一个选项或点击"继续"后，推进到下一个可交互节点。 */
export function advanceFromNode(
  nextNodeId: string,
  dialogue: DialogueDef,
  ctx: DialogueCtx,
  executor: DialogueActionExecutor,
): DialoguePlayerState {
  return resolveNode(nextNodeId, dialogue, ctx, executor);
}

// ---------- 内部工具 ----------

function buildSayState(
  node: DialogueNodeSay,
  nodeId: string,
): DialogueStateSay {
  return {
    kind: "say",
    nodeId,
    speaker: node.speaker,
    text: node.text,
    next: node.next,
  };
}

// economy/cost.ts — 开销的校验与扣除操作。
//
// 只处理 CostDef 描述的游戏外资源：货币与堆叠材料。
// MP / TP / GearInstance 不在此处处理。

import type { GameState } from "../infra/state/types";
import { countItem } from "../inventory/ops";
import type { CostDef } from "./types";

export interface CostCheckContext {
  state: GameState;
  /** 消耗材料时读取哪个背包（通常是角色个人背包的 charId）。 */
  inventoryId: string;
}

/** 检查当前状态是否满足 CostDef。
 *  返回 true 表示可以承担；返回 false 表示不足（但不修改任何状态）。 */
export function checkCost(cost: CostDef, ctx: CostCheckContext): boolean {
  // 检查货币
  if (cost.currencies) {
    for (const [currId, amount] of Object.entries(cost.currencies)) {
      const balance = ctx.state.currencies[currId] ?? 0;
      if (balance < amount) return false;
    }
  }

  // 检查材料
  if (cost.items?.length) {
    const inv = ctx.state.inventories[ctx.inventoryId];
    if (!inv) return false;
    for (const { itemId, qty } of cost.items) {
      const held = countItem(inv, itemId);
      if (held < qty) return false;
    }
  }

  return true;
}

/** 扣除 CostDef 中的所有资源。调用前必须先调用 checkCost 确认可以承担。
 *  如果扣除时发现不足，则抛出异常（属于逻辑错误，不应在正常路径发生）。 */
export function applyCost(cost: CostDef, ctx: CostCheckContext): void {
  // 扣除货币
  if (cost.currencies) {
    for (const [currId, amount] of Object.entries(cost.currencies)) {
      const balance = ctx.state.currencies[currId] ?? 0;
      if (balance < amount) {
        throw new Error(
          `applyCost: insufficient currency "${currId}": have ${balance}, need ${amount}`,
        );
      }
      ctx.state.currencies[currId] = balance - amount;
    }
  }

  // 扣除材料
  if (cost.items?.length) {
    const inv = ctx.state.inventories[ctx.inventoryId];
    if (!inv) {
      throw new Error(
        `applyCost: no inventory found for "${ctx.inventoryId}"`,
      );
    }
    for (const { itemId, qty } of cost.items) {
      let remaining = qty;
      for (let i = 0; i < inv.slots.length && remaining > 0; i++) {
        const slot = inv.slots[i];
        if (!slot || slot.kind !== "stack" || slot.itemId !== itemId) continue;
        const take = Math.min(remaining, slot.qty);
        slot.qty -= take;
        if (slot.qty === 0) inv.slots[i] = null;
        remaining -= take;
      }
      if (remaining > 0) {
        throw new Error(
          `applyCost: insufficient item "${itemId}": still need ${remaining} more`,
        );
      }
    }
  }
}

/** 返还 CostDef 中的所有资源（预扣除后中断时使用）。
 *
 *  货币直接加回 state.currencies。
 *  材料通过背包 addStack 放回；如果背包已满则静默丢失
 *  （返还场景是异常情况，应由上层逻辑保证不会出现背包已满的极端情况）。
 *
 *  各模块自行决定何时调用此函数，框架只提供接口。
 */
export function refundCost(cost: CostDef, ctx: CostCheckContext): void {
  // 返还货币
  if (cost.currencies) {
    for (const [currId, amount] of Object.entries(cost.currencies)) {
      ctx.state.currencies[currId] = (ctx.state.currencies[currId] ?? 0) + amount;
    }
  }

  // 返还材料（尽力而为；背包满时忽略溢出）
  if (cost.items?.length) {
    const inv = ctx.state.inventories[ctx.inventoryId];
    if (!inv) return;
    // 使用动态 import 避免循环依赖，直接内联 addStack 逻辑
    for (const { itemId, qty } of cost.items) {
      // 先找同类堆叠合并
      let remaining = qty;
      for (const slot of inv.slots) {
        if (!slot || slot.kind !== "stack" || slot.itemId !== itemId) continue;
        const space = Number.MAX_SAFE_INTEGER - slot.qty; // 无栈上限（返还场景）
        const add = Math.min(remaining, space);
        slot.qty += add;
        remaining -= add;
        if (remaining <= 0) break;
      }
      // 再找空槽
      if (remaining > 0) {
        for (let i = 0; i < inv.slots.length && remaining > 0; i++) {
          if (inv.slots[i] !== null) continue;
          inv.slots[i] = { kind: "stack", itemId, qty: remaining };
          remaining = 0;
        }
      }
      // 若仍有剩余（背包已满），静默丢失
    }
  }
}

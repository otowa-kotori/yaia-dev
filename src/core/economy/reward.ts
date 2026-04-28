// economy/reward.ts — 奖励发放与摇号逻辑。
//
// rollDrops：把 drops 中的 LootEntry 按概率摇出具体的 ItemGrant 列表。
// grantRewards：把 RewardBundle（含已摇号的 drops + 保底 items）发放给角色。
// grantItemToCharacter：发放单个物品给指定角色；背包满时走 pendingLoot。
//   这是"单玩家获取道具"的可替换接入点——未来改成共享背包只改此函数。

import { isPlayer, rebuildCharacterDerived } from "../entity/actor";
import type { PlayerCharacter, Character } from "../entity/actor/types";
import { grantCharacterXp, grantSkillXp } from "../growth/leveling";
import { getSkill } from "../content/registry";
import { getItem } from "../content/registry";
import { addStack, addGear } from "../inventory";
import { getInventoryStackLimit } from "../inventory/stack-limit";
import { createGearInstance } from "../item";
import type { Rng } from "../infra/rng";
import type { GameState } from "../infra/state/types";
import type { GameEventBus } from "../infra/events";
import type { PendingLootEntry } from "../world/stage/types";
import type { ItemId } from "../content/types";
import type {
  RewardBundle,
  LootEntry,
  ItemGrant,
  RolledItems,
  RewardSource,
} from "./types";

// ---------- 摇号 ----------

export interface RollDropsOptions {
  /** 爆率倍数，默认 1.0。effectiveChance = min(1.0, entry.chance × dropRateMod)。
   *  超出 1.0 的部分当前版本 clamp，未来可扩展为溢出额外次数。 */
  dropRateMod?: number;
}

/** 把一组 LootEntry 按概率摇出结果，返回已确定数量的 ItemGrant 列表。
 *  摇号只发生在 drops 分支；items（保底）不经过此函数。 */
export function rollDrops(
  drops: readonly LootEntry[],
  rng: Rng,
  opts: RollDropsOptions = {},
): RolledItems {
  const mod = opts.dropRateMod ?? 1.0;
  const result: ItemGrant[] = [];
  for (const entry of drops) {
    const effectiveChance = Math.min(1.0, entry.chance * mod);
    if (!rng.chance(effectiveChance)) continue;
    const qty = rng.int(entry.minQty, entry.maxQty);
    if (qty > 0) result.push({ itemId: entry.itemId, qty });
  }
  return result;
}

// ---------- 发放奖励给单个角色 ----------

export interface GrantRewardsContext {
  state: GameState;
  bus: GameEventBus;
  rng: Rng;
  currentTick: number;
  source: RewardSource;
}

/** 把 RewardBundle 全额发放给单个角色（非多人分配版本）。
 *
 *  drops 如需先摇号，调用方自己调 rollDrops，然后把结果并入 bundle.items 或单独传入。
 *  此函数只处理已经确定数量的物品、货币与经验。
 *
 *  典型用途：制作奖励、采集奖励、副本完成奖励（单人发放）。
 *  多人分配请用 distributeRewards（loot.ts）。
 */
export function grantRewards(
  bundle: RewardBundle,
  target: Character,
  ctx: GrantRewardsContext,
): void {
  if (!isPlayer(target)) return; // 怪物不收奖励
  const pc = target as PlayerCharacter;
  const charId = pc.id;
  const scope = playerLogScope(pc);

  // 保底物品
  if (bundle.items?.length) {
    for (const { itemId, qty } of bundle.items) {
      grantItemToCharacter(charId, itemId, qty, ctx);
      ctx.bus.emit("loot", {
        charId,
        itemId,
        qty,
        stageId: scope.stageId,
        dungeonSessionId: scope.dungeonSessionId,
      });
    }
  }

  // 货币
  if (bundle.currencies) {
    for (const [currId, amount] of Object.entries(bundle.currencies)) {
      if (amount === 0) continue;
      const nextTotal = (ctx.state.currencies[currId] ?? 0) + amount;
      ctx.state.currencies[currId] = nextTotal;
      ctx.bus.emit("currencyChanged", {
        currencyId: currId,
        amount,
        total: nextTotal,
        source: rewardSourceToCurrencyChangeSource(ctx.source),
        charId,
        stageId: scope.stageId,
        dungeonSessionId: scope.dungeonSessionId,
      });
    }
  }

  // 技能经验
  if (bundle.xp?.length) {
    for (const { skillId, amount } of bundle.xp) {
      const skillDef = getSkill(skillId);
      grantSkillXp(pc, skillDef, amount, { bus: ctx.bus });
    }
  }

  // 角色经验
  if (bundle.charXp) {
    const levelsGained = grantCharacterXp(pc, bundle.charXp, { bus: ctx.bus });
    if (levelsGained > 0) {
      rebuildCharacterDerived(pc, ctx.state.worldRecord);
    }
  }
}

// ---------- 单玩家发放物品 — 可替换接入点 ----------

/** 把 qty 个 itemId 发放给指定角色的个人背包。
 *  背包满时，溢出进该角色所在 Stage 的 pendingLoot。
 *
 *  未来改成共享背包时，只替换此函数的实现。
 *  注意：此函数不发出 loot 事件，由调用方决定是否发出。
 */
export function grantItemToCharacter(
  charId: string,
  itemId: ItemId,
  qty: number,
  ctx: Pick<GrantRewardsContext, "state" | "bus" | "rng">,
): void {
  const inv = ctx.state.inventories[charId];
  if (!inv) {
    throw new Error(
      `grantItemToCharacter: no inventory for charId "${charId}". Hero spawn should have created one.`,
    );
  }
  const def = getItem(itemId);
  if (def.stackable) {
    const stackLimit = getInventoryStackLimit(ctx.state, charId);
    const res = addStack(inv, itemId, qty, stackLimit);
    if (!res.ok) {
      pushToPendingLoot(ctx, charId, { kind: "stack", itemId, qty: res.remaining });
    }
    return;
  }
  for (let i = 0; i < qty; i++) {
    const gear = createGearInstance(itemId, { rng: ctx.rng });
    const res = addGear(inv, gear);
    if (!res.ok) {
      pushToPendingLoot(ctx, charId, { kind: "gear", instance: gear });
    }
  }
}

// ---------- 内部工具 ----------

function pushToPendingLoot(
  ctx: Pick<GrantRewardsContext, "state" | "bus">,
  charId: string,
  entry: PendingLootEntry,
): void {
  const hero = ctx.state.actors.find((a) => a.id === charId);
  if (!hero || !isPlayer(hero)) return;
  const stageId = (hero as PlayerCharacter).stageId;
  if (!stageId) return;
  const session = ctx.state.stages[stageId];
  if (!session) return;

  if (entry.kind === "stack") {
    const existing = session.pendingLoot.find(
      (e): e is PendingLootEntry & { kind: "stack" } =>
        e.kind === "stack" && e.itemId === entry.itemId,
    );
    if (existing) {
      existing.qty += entry.qty;
    } else {
      session.pendingLoot.push(entry);
    }
    ctx.bus.emit("pendingLootOverflowed", {
      charId,
      stageId,
      itemId: entry.itemId,
      qty: entry.qty,
    });
  } else {
    session.pendingLoot.push(entry);
    ctx.bus.emit("pendingLootOverflowed", {
      charId,
      stageId,
      itemId: entry.instance.itemId,
      qty: 1,
    });
  }
  ctx.bus.emit("pendingLootChanged", { charId, stageId });
}

function playerLogScope(hero: PlayerCharacter): {
  stageId?: string;
  dungeonSessionId?: string;
} {
  return {
    stageId: hero.stageId ?? undefined,
    dungeonSessionId: hero.dungeonSessionId ?? undefined,
  };
}

function rewardSourceToCurrencyChangeSource(
  source: RewardSource,
): import("../infra/events").CurrencyChangeSource {
  switch (source.kind) {
    case "kill": return "kill_reward";
    case "wave": return "wave_reward";
    case "dungeon_wave":
    case "dungeon_completion": return "dungeon_reward";
    default: return "other";
  }
}

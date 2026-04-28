// economy/loot.ts — 多人奖励分配。
//
// distributeRewards 是多人场景的统一入口：
//   - 货币 / charXp / skillXp：floor(总量 / 人数)，余数随机给一人。
//   - items（保底物品）：整批随机给一人。
//   - drops（摇号）：每人独立摇，effectiveChance = entry.chance / partySize。
//
// 单人时此函数退化为 grantRewards（partySize = 1，无分配开销）。

import type { PlayerCharacter } from "../entity/actor/types";
import type { Rng } from "../infra/rng";
import type { RewardBundle, RewardSource, LootDistributionMode } from "./types";
import { rollDrops, grantRewards, grantItemToCharacter } from "./reward";
import type { GameEventBus } from "../infra/events";
import type { GameState } from "../infra/state/types";

export interface DistributeRewardsContext {
  state: GameState;
  bus: GameEventBus;
  rng: Rng;
  currentTick: number;
  source: RewardSource;
  /** 爆率倍数，默认 1.0。 */
  dropRateMod?: number;
  /** loot 分配模式，默认 "random_member"。 */
  distributionMode?: LootDistributionMode;
}

/**
 * 把 RewardBundle 分配给多个角色。
 *
 * @param bundle  原始奖励束（来自内容配置，还未摇号）
 * @param members 参与分配的存活角色列表（已过滤死亡）
 * @param ctx     运行上下文
 */
export function distributeRewards(
  bundle: RewardBundle,
  members: readonly PlayerCharacter[],
  ctx: DistributeRewardsContext,
): void {
  if (members.length === 0) return;

  const n = members.length;
  const rng = ctx.rng;

  // --- 1. drops：每人独立摇，chance / partySize ---
  if (bundle.drops?.length) {
    for (const member of members) {
      const rolledItems = rollDrops(bundle.drops, rng, {
        // 多人时每人的有效概率是基础概率除以人数，维持总期望不变
        dropRateMod: (ctx.dropRateMod ?? 1.0) / n,
      });
      if (rolledItems.length === 0) continue;

      // 摇出的物品发给本人
      const scope = playerLogScope(member);
      for (const { itemId, qty } of rolledItems) {
        grantItemToCharacter(member.id, itemId, qty, ctx);
        ctx.bus.emit("loot", {
          charId: member.id,
          itemId,
          qty,
          stageId: scope.stageId,
          dungeonSessionId: scope.dungeonSessionId,
        });
      }
    }
  }

  // --- 2. items（保底）：整批随机给一人 ---
  if (bundle.items?.length) {
    const lucky = rng.pick([...members]);
    const scope = playerLogScope(lucky);
    for (const { itemId, qty } of bundle.items) {
      grantItemToCharacter(lucky.id, itemId, qty, ctx);
      ctx.bus.emit("loot", {
        charId: lucky.id,
        itemId,
        qty,
        stageId: scope.stageId,
        dungeonSessionId: scope.dungeonSessionId,
      });
    }
  }

  // --- 3. 货币：floor(总量 / n)，余数随机给一人 ---
  if (bundle.currencies) {
    for (const [currId, total] of Object.entries(bundle.currencies)) {
      if (total === 0) continue;
      const share = Math.floor(total / n);
      const remainder = total - share * n;
      const luckyIdx = remainder > 0 ? rng.int(0, n - 1) : -1;

      for (let i = 0; i < n; i++) {
        const amount = share + (i === luckyIdx ? remainder : 0);
        if (amount === 0) continue;
        const member = members[i]!;
        const scope = playerLogScope(member);
        const nextTotal = (ctx.state.currencies[currId] ?? 0) + amount;
        ctx.state.currencies[currId] = nextTotal;
        ctx.bus.emit("currencyChanged", {
          currencyId: currId,
          amount,
          total: nextTotal,
          source: rewardSourceToCurrencySource(ctx.source),
          charId: member.id,
          stageId: scope.stageId,
          dungeonSessionId: scope.dungeonSessionId,
        });
      }
    }
  }

  // --- 4. charXp：floor(总量 / n)，余数随机给一人 ---
  if (bundle.charXp && bundle.charXp > 0) {
    const total = bundle.charXp;
    const share = Math.floor(total / n);
    const remainder = total - share * n;
    const luckyIdx = remainder > 0 ? rng.int(0, n - 1) : -1;

    for (let i = 0; i < n; i++) {
      const amount = share + (i === luckyIdx ? remainder : 0);
      if (amount === 0) continue;
      // 直接调用 grantRewards 分发经验（含升级重建派生）
      grantRewards({ charXp: amount }, members[i]!, ctx);
    }
  }

  // --- 5. skillXp：每个 skillId 单独分配，规则同 charXp ---
  if (bundle.xp?.length) {
    for (const { skillId, amount: total } of bundle.xp) {
      if (total <= 0) continue;
      const share = Math.floor(total / n);
      const remainder = total - share * n;
      const luckyIdx = remainder > 0 ? rng.int(0, n - 1) : -1;

      for (let i = 0; i < n; i++) {
        const amount = share + (i === luckyIdx ? remainder : 0);
        if (amount === 0) continue;
        grantRewards({ xp: [{ skillId, amount }] }, members[i]!, ctx);
      }
    }
  }
}

// ---------- 内部工具 ----------

function playerLogScope(hero: PlayerCharacter): {
  stageId?: string;
  dungeonSessionId?: string;
} {
  return {
    stageId: hero.stageId ?? undefined,
    dungeonSessionId: hero.dungeonSessionId ?? undefined,
  };
}

function rewardSourceToCurrencySource(
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

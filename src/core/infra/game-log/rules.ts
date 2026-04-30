import { isPlayer } from "../../entity/actor";
import { getContent } from "../../content/registry";
import type { GameEvents } from "../events";
import { SHARED_INVENTORY_KEY, type GameState } from "../state/types";
import type { GameLogCategory, GameLogEntry } from "./types";

export interface GameLogRuleContext {
  state: Readonly<GameState>;
  currentTick: number;
}

type LoggedGameEventName = Exclude<keyof GameEvents, "gameLogAppended">;
type GameLogRuleResult = GameLogEntry | GameLogEntry[] | null;

export const gameLogRules = {
  levelup: (payload: GameEvents["levelup"], ctx: GameLogRuleContext) => {
    const heroName = actorName(ctx.state, payload.charId);
    if (payload.kind === "character") {
      return entry(ctx, "growth", `${heroName} 升到了 ${payload.level} 级。`, payload.charId);
    }
    return entry(
      ctx,
      "growth",
      `${heroName} 的 ${skillName(payload.skillId)} 升到了 ${payload.level} 级。`,
      payload.charId,
    );
  },
  locationEntered: (
    payload: GameEvents["locationEntered"],
    ctx: GameLogRuleContext,
  ) =>
    entry(
      ctx,
      "world",
      `${actorName(ctx.state, payload.charId)} 来到了 ${locationName(payload.locationId)}。`,
      payload.charId,
    ),
  locationLeft: (
    payload: GameEvents["locationLeft"],
    ctx: GameLogRuleContext,
  ) =>
    entry(
      ctx,
      "world",
      `${actorName(ctx.state, payload.charId)} 离开了 ${locationName(payload.locationId)}。`,
      payload.charId,
    ),
  activityStarted: (
    payload: GameEvents["activityStarted"],
    ctx: GameLogRuleContext,
  ) => {
    const heroName = actorName(ctx.state, payload.charId);
    switch (payload.kind) {
      case "combat":
        return entry(
          ctx,
          "activity",
          `${heroName} 开始在 ${combatZoneName(payload.combatZoneId)} 战斗。`,
          payload.charId,
        );
      case "gather":
        return entry(
          ctx,
          "activity",
          `${heroName} 开始采集 ${resourceNodeName(payload.resourceNodeId)}。`,
          payload.charId,
        );
      case "dungeon":
        return entry(
          ctx,
          "dungeon",
          `${heroName} 与队伍进入了副本《${dungeonName(payload.dungeonId)}》。`,
          payload.charId,
        );
    }
  },
  activityStopped: (
    payload: GameEvents["activityStopped"],
    ctx: GameLogRuleContext,
  ) => {
    const heroName = actorName(ctx.state, payload.charId);
    const why = stopReasonText(payload.reason);
    switch (payload.kind) {
      case "combat":
        return entry(ctx, "activity", `${heroName}${why}停止了当前战斗。`, payload.charId);
      case "gather":
        return entry(ctx, "activity", `${heroName}${why}结束了当前采集。`, payload.charId);
      case "dungeon":
        return entry(ctx, "dungeon", `${heroName}${why}离开了当前副本。`, payload.charId);
    }
  },
  battleStarted: (
    payload: GameEvents["battleStarted"],
    ctx: GameLogRuleContext,
  ) => {
    const leader = partyLeadName(ctx.state, payload.participantIds);
    const charId = payload.partyCharIds[0];
    if (payload.dungeonSessionId) {
      return entry(
        ctx,
        "battle",
        `${leader} 所在队伍在副本《${dungeonName(payload.dungeonId ?? payload.dungeonSessionId)}》第 ${payload.waveIndex + 1} 波遭遇了敌人。`,
        charId,
      );
    }
    return entry(
      ctx,
      "battle",
      `${leader} 在 ${combatZoneName(payload.combatZoneId)} 遭遇了敌人。`,
      charId,
    );
  },
  battleActionStarted: (
    payload: GameEvents["battleActionStarted"],
    ctx: GameLogRuleContext,
  ) => {
    const actor = actorName(ctx.state, payload.actorId);
    const ability = talentName(payload.abilityId);
    const targets = listOrFallback(payload.targetIds.map((id) => actorName(ctx.state, id)), "目标未知");
    // Attribute to the first player character involved, or the actor itself.
    const charId = findPlayerCharIdForActor(ctx.state, payload.actorId);
    return entry(
      ctx,
      "battle",
      `${actor} 使用了 ${ability}，目标：${targets}。`,
      charId,
    );
  },
  battleActionResolved: (
    payload: GameEvents["battleActionResolved"],
    ctx: GameLogRuleContext,
  ) => {
    // Only log skips; successful actions are already announced by battleActionStarted.
    if (payload.outcome !== "skip") return null;
    const actor = actorName(ctx.state, payload.actorId);
    const note = skipReasonText(payload.note);
    const charId = findPlayerCharIdForActor(ctx.state, payload.actorId);
    return entry(
      ctx,
      "battle",
      `${actor} 本回合未能行动${note ? `（${note}）` : ""}。`,
      charId,
    );
  },
  damage: (
    payload: GameEvents["damage"],
    ctx: GameLogRuleContext,
  ) => {
    const attacker = actorName(ctx.state, payload.attackerId);
    const target = actorName(ctx.state, payload.targetId);
    // Attribute to the player character involved (attacker or target).
    const charId =
      findPlayerCharIdForActor(ctx.state, payload.attackerId) ??
      findPlayerCharIdForActor(ctx.state, payload.targetId);

    if (payload.isMiss) {
      return entry(ctx, "battle", `${attacker} 对 ${target} 的攻击未命中。`, charId);
    }

    const prefix = payload.isCrit ? "暴击！" : "";
    return entry(
      ctx,
      "battle",
      `${prefix}${attacker} 对 ${target} 造成了 ${payload.amount} 点伤害。`,
      charId,
    );
  },
  battleActorDied: (
    payload: GameEvents["battleActorDied"],
    ctx: GameLogRuleContext,
  ) => {
    const charId = findPlayerCharIdForActor(ctx.state, payload.victimId);
    return entry(
      ctx,
      "battle",
      `${actorName(ctx.state, payload.victimId)} 被击倒了。`,
      charId,
    );
  },
  battleEnded: (
    payload: GameEvents["battleEnded"],
    ctx: GameLogRuleContext,
  ) => {
    const outcome =
      payload.outcome === "players_won"
        ? "战斗胜利。"
        : payload.outcome === "enemies_won"
          ? "战斗失败。"
          : "战斗以平局结束。";
    return entry(ctx, "battle", outcome, undefined);
  },
  loot: (payload: GameEvents["loot"], ctx: GameLogRuleContext) =>
    entry(
      ctx,
      "reward",
      `${actorName(ctx.state, payload.charId)} 获得了 ${itemName(payload.itemId)}×${payload.qty}。`,
      payload.charId,
    ),
  equipmentUpdated: (
    payload: GameEvents["equipmentUpdated"],
    ctx: GameLogRuleContext,
  ) =>
    entry(
      ctx,
      "inventory",
      payload.action === "equip"
        ? `${actorName(ctx.state, payload.charId)} 装备了 ${itemName(payload.itemId)}。`
        : `${actorName(ctx.state, payload.charId)} 卸下了 ${itemName(payload.itemId)}。`,
      payload.charId,
    ),
  crafted: (payload: GameEvents["crafted"], ctx: GameLogRuleContext) =>
    entry(
      ctx,
      "inventory",
      `${actorName(ctx.state, payload.charId)} 制作了 ${recipeName(payload.recipeId)}。`,
      payload.charId,
    ),
  inventoryDiscarded: (
    payload: GameEvents["inventoryDiscarded"],
    ctx: GameLogRuleContext,
  ) =>
    entry(
      ctx,
      "inventory",
      `${actorName(ctx.state, payload.charId)} 丢弃了 ${itemName(payload.itemId)}×${payload.qty}。`,
      payload.charId,
    ),
  inventoryTransferred: (
    payload: GameEvents["inventoryTransferred"],
    ctx: GameLogRuleContext,
  ) => {
    const heroName = actorName(ctx.state, payload.charId);
    const item = `${itemName(payload.itemId)}×${payload.qty}`;
    if (payload.toInventoryId === SHARED_INVENTORY_KEY) {
      return entry(ctx, "inventory", `${heroName} 把 ${item} 放入了共享仓库。`, payload.charId);
    }
    if (payload.fromInventoryId === SHARED_INVENTORY_KEY) {
      return entry(ctx, "inventory", `${heroName} 从共享仓库取出了 ${item}。`, payload.charId);
    }
    return entry(
      ctx,
      "inventory",
      `${heroName} 转移了 ${item}（${payload.fromInventoryId} → ${payload.toInventoryId}）。`,
      payload.charId,
    );
  },
  currencyChanged: (
    payload: GameEvents["currencyChanged"],
    ctx: GameLogRuleContext,
  ) => {
    if (payload.amount === 0) return null;
    const absAmount = Math.abs(payload.amount);
    const verb = payload.amount > 0 ? "获得了" : "失去了";
    const owner = payload.charId ? `${actorName(ctx.state, payload.charId)} ` : "";
    const source = currencySourceLabel(payload.source);
    return entry(
      ctx,
      "economy",
      `${owner}${verb}${absAmount} ${currencyName(payload.currencyId)}${source ? `（${source}）` : ""}。`,
      payload.charId,
    );
  },
  upgradePurchased: (
    payload: GameEvents["upgradePurchased"],
    ctx: GameLogRuleContext,
  ) =>
    entry(
      ctx,
      "economy",
      `购买了全局升级\u201c${upgradeName(payload.upgradeId)}\u201d Lv.${payload.level}，消耗 ${payload.cost} ${currencyName(payload.costCurrency)}。`,
      undefined,
    ),
  talentAllocated: (payload: GameEvents["talentAllocated"], ctx: GameLogRuleContext) =>
    entry(ctx, "growth",
      `${actorName(ctx.state, payload.charId)} 的天赋\u201c${talentName(payload.talentId)}\u201d升到了 ${payload.newLevel} 级。`,
      payload.charId),
  pendingLootOverflowed: (
    payload: GameEvents["pendingLootOverflowed"],
    ctx: GameLogRuleContext,
  ) =>
    entry(
      ctx,
      "inventory",
      `${actorName(ctx.state, payload.charId)} 的背包已满，${itemName(payload.itemId)}×${payload.qty} 被放入待拾取。`,
      payload.charId,
    ),
  pendingLootPicked: (
    payload: GameEvents["pendingLootPicked"],
    ctx: GameLogRuleContext,
  ) =>
    entry(
      ctx,
      "inventory",
      `${actorName(ctx.state, payload.charId)} 拾取了 ${itemName(payload.itemId)}×${payload.qty}。`,
      payload.charId,
    ),
  pendingLootLost: (
    payload: GameEvents["pendingLootLost"],
    ctx: GameLogRuleContext,
  ) => {
    const summary = listOrFallback(
      payload.entries.map((entryDef) => `${itemName(entryDef.itemId)}×${entryDef.qty}`),
      "未拾取物品",
    );
    return entry(
      ctx,
      "inventory",
      `${actorName(ctx.state, payload.charId)} 离开场景后遗失了 ${summary}。`,
      payload.charId,
    );
  },
  waveResolved: (
    payload: GameEvents["waveResolved"],
    ctx: GameLogRuleContext,
  ) => {
    const result =
      payload.outcome === "players_won"
        ? `清理了 ${combatZoneName(payload.combatZoneId)} 的第 ${payload.waveIndex + 1} 波。`
        : `在 ${combatZoneName(payload.combatZoneId)} 的第 ${payload.waveIndex + 1} 波败退了。`;
    return entry(
      ctx,
      "battle",
      `${actorName(ctx.state, payload.charId)} ${result}`,
      payload.charId,
    );
  },
  dungeonWaveCleared: (
    payload: GameEvents["dungeonWaveCleared"],
    ctx: GameLogRuleContext,
  ) =>
    entry(
      ctx,
      "dungeon",
      `副本《${dungeonName(payload.dungeonId)}》第 ${payload.waveIndex + 1} 波已清理。`,
      undefined,
    ),
  dungeonCompleted: (
    payload: GameEvents["dungeonCompleted"],
    ctx: GameLogRuleContext,
  ) =>
    entry(
      ctx,
      "dungeon",
      `副本《${dungeonName(payload.dungeonId)}》已通关。`,
      undefined,
    ),
  dungeonFailed: (
    payload: GameEvents["dungeonFailed"],
    ctx: GameLogRuleContext,
  ) =>
    entry(
      ctx,
      "dungeon",
      `副本《${dungeonName(payload.dungeonId)}》挑战失败，止步第 ${payload.waveIndex + 1} 波。`,
      undefined,
    ),
  dungeonAbandoned: (
    payload: GameEvents["dungeonAbandoned"],
    ctx: GameLogRuleContext,
  ) =>
    entry(
      ctx,
      "dungeon",
      `已放弃副本《${dungeonName(payload.dungeonId)}》。`,
      undefined,
    ),
  questAccepted: (
    payload: GameEvents["questAccepted"],
    ctx: GameLogRuleContext,
  ) =>
    entry(ctx, "quest", `接取了任务「${questName(payload.questId)}」。`, undefined),
  questReady: (
    payload: GameEvents["questReady"],
    ctx: GameLogRuleContext,
  ) =>
    entry(ctx, "quest", `任务「${questName(payload.questId)}」可以提交了。`, undefined),
  questCompleted: (
    payload: GameEvents["questCompleted"],
    ctx: GameLogRuleContext,
  ) =>
    entry(ctx, "quest", `完成了任务「${questName(payload.questId)}」！`, undefined),
  questAbandoned: (
    payload: GameEvents["questAbandoned"],
    ctx: GameLogRuleContext,
  ) =>
    entry(ctx, "quest", `放弃了任务「${questName(payload.questId)}」。`, undefined),
} satisfies Partial<{
  [K in LoggedGameEventName]: (
    payload: GameEvents[K],
    ctx: GameLogRuleContext,
  ) => GameLogRuleResult;
}>;

function entry(
  ctx: GameLogRuleContext,
  category: GameLogCategory,
  text: string,
  charId: string | undefined,
): GameLogEntry {
  return {
    tick: ctx.currentTick,
    category,
    text,
    ...(charId ? { charId } : {}),
  };
}

function actorName(state: Readonly<GameState>, actorId: string): string {
  return state.actors.find((actor) => actor.id === actorId)?.name ?? actorId;
}

function partyLeadName(state: Readonly<GameState>, participantIds: readonly string[]): string {
  for (const id of participantIds) {
    const actor = state.actors.find((candidate) => candidate.id === id);
    if (actor && isPlayer(actor)) return actor.name;
  }
  return actorName(state, participantIds[0] ?? "未知角色");
}

/** For battle events that carry an actorId (which may be an enemy),
 *  find the player character in the same battle, or return the actorId
 *  itself if it's already a player. */
function findPlayerCharIdForActor(
  state: Readonly<GameState>,
  actorId: string,
): string | undefined {
  const actor = state.actors.find((a) => a.id === actorId);
  if (actor && isPlayer(actor)) return actorId;
  // Find the battle this actor is in, then return the first player char.
  const battle = state.battles.find(
    (b) => b.outcome === "ongoing" && b.participantIds.includes(actorId),
  );
  if (!battle) return undefined;
  for (const pid of battle.participantIds) {
    const p = state.actors.find((a) => a.id === pid);
    if (p && isPlayer(p)) return pid;
  }
  return undefined;
}

function talentName(id: string): string {
  return getContent().talents[id]?.name ?? id;
}

function combatZoneName(id: string): string {
  return getContent().combatZones[id]?.name ?? id;
}

function dungeonName(id: string): string {
  return getContent().dungeons[id]?.name ?? id;
}

function itemName(id: string): string {
  return getContent().items[id]?.name ?? id;
}

function locationName(id: string): string {
  return getContent().locations[id]?.name ?? id;
}

function recipeName(id: string): string {
  return getContent().recipes[id]?.name ?? id;
}

function resourceNodeName(id: string): string {
  return getContent().resourceNodes[id]?.name ?? id;
}

function skillName(id: string): string {
  return getContent().skills[id]?.name ?? id;
}

function upgradeName(id: string): string {
  return getContent().upgrades[id]?.name ?? id;
}

function questName(id: string): string {
  return getContent().quests[id]?.name ?? id;
}

function currencyName(id: string): string {
  if (id === "currency.gold") return "金币";
  return id;
}

function currencySourceLabel(source: GameEvents["currencyChanged"]["source"]): string {
  switch (source) {
    case "kill_reward":
      return "击杀奖励";
    case "wave_reward":
      return "波次奖励";
    case "dungeon_reward":
      return "副本奖励";
    case "upgrade_purchase":
      return "升级购买";
    case "other":
      return "";
  }
}

function stopReasonText(reason: GameEvents["activityStopped"]["reason"]): string {
  switch (reason) {
    case "player":
      return "主动";
    case "left_location":
      return "因离开地点而";
    case "switch_activity":
      return "因切换活动而";
    case "system":
      return "因系统状态变化而";
  }
}

function skipReasonText(note?: string): string {
  if (!note) return "";
  switch (note) {
    case "no valid plan":
      return "没有有效目标";
    case "on_cooldown":
      return "技能冷却中";
    case "insufficient_mp":
      return "法力不足";
    case "no_valid_targets":
      return "没有可用目标";
    case "wrong_target_count":
      return "目标数量不正确";
    case "target_wrong_side":
      return "目标阵营不正确";
    case "not_known":
      return "尚未学会该技能";
    case "caster_dead":
      return "角色已倒下";
    case "unknown_ability":
    case "unknown_talent":
      return "技能不存在";
    default:
      return note;
  }
}

function listOrFallback(values: readonly string[], fallback: string): string {
  return values.length > 0 ? values.join("、") : fallback;
}

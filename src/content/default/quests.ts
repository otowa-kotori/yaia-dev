// 默认任务定义。
//
// 示例任务，用于验证任务系统的各项功能：
//   1. 事件型目标 + 自动提交 + 奖励
//   2. 状态型目标 + 手动提交（交付扣材料）+ 奖励
//   3. 可重复任务
//   4. 需手动接取的任务

import type { QuestDef, QuestId } from "../../core/content/types";

function q(id: string, def: Omit<QuestDef, "id">): QuestDef {
  return { id: id as QuestId, ...def };
}

// ── 1. 初出茅庐 — 击杀 3 只史莱姆 ──

export const questSlimeHunt = q("quest.tutorial.slime_hunt", {
  name: "初出茅庐",
  description: "击杀 3 只史莱姆，证明你的实力。",
  autoAccept: true,
  objectives: [
    {
      kind: "event",
      description: "击杀 3 只史莱姆",
      eventType: "kill",
      filter: {
        field: "defId",
        op: "eq",
        value: "monster.slime",
      },
      targetCount: 3,
    },
  ],
  rewards: {
    currencies: { "currency.gold": 50 },
    charXp: 30,
  },
});

// ── 2. 矿石收集 — 持有铜矿石后手动提交 ──

export const questOreCollection = q("quest.tutorial.ore_collection", {
  name: "矿石收集",
  description: "收集 5 份铜矿石并交付。采集完成后在任务面板提交。",
  objectives: [
    {
      kind: "state",
      description: "持有 5 个铜矿石",
      check: {
        type: "hasItem",
        itemId: "item.ore.copper" as any,
        qty: 5,
      },
    },
  ],
  turnIn: {
    mode: "manual",
    cost: {
      items: [{ itemId: "item.ore.copper" as any, qty: 5 }],
    },
  },
  rewards: {
    currencies: { "currency.gold": 80 },
    charXp: 50,
  },
});

// ── 3. 日常狩猎 — 可重复 ──

export const questDailyHunt = q("quest.daily.hunt", {
  name: "日常狩猎",
  description: "击杀 5 只任意怪物。可重复完成。",
  autoAccept: true,
  repeatable: true,
  objectives: [
    {
      kind: "event",
      description: "击杀 5 只怪物",
      eventType: "kill",
      targetCount: 5,
    },
  ],
  rewards: {
    currencies: { "currency.gold": 30 },
    charXp: 20,
  },
});

// ── 4. 武装自己 — 手动接取，装备一件武器 ──

export const questEquipWeapon = q("quest.tutorial.equip_weapon", {
  name: "武装自己",
  description: "装备任意一件武器来提升战斗力。",
  objectives: [
    {
      kind: "event",
      description: "装备一件武器",
      eventType: "equipmentUpdated",
      filter: {
        all: [
          { field: "action", op: "eq", value: "equip" },
          { field: "slot", op: "eq", value: "weapon" },
        ],
      },
      targetCount: 1,
    },
  ],
  rewards: {
    currencies: { "currency.gold": 20 },
    charXp: 15,
  },
});

// ── 导出注册表 ──

export const quests: Record<string, QuestDef> = {
  [questSlimeHunt.id]: questSlimeHunt,
  [questOreCollection.id]: questOreCollection,
  [questDailyHunt.id]: questDailyHunt,
  [questEquipWeapon.id]: questEquipWeapon,
};

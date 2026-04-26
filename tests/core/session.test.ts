import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { ACTIVITY_GATHER_KIND } from "../../src/core/world/activity";
import { COMBAT_ZONE_RECOVERY_RULES } from "../../src/core/world/activity/recovery";

import { getAttr, isResourceNode } from "../../src/core/entity/actor";
import { ATTR } from "../../src/core/entity/attribute";
import { resetContent } from "../../src/core/content";
import { addStack, countItem } from "../../src/core/inventory";
import { deserialize, serialize } from "../../src/core/save";
import { createGameSession, type GameSession } from "../../src/core/session";
import {
  buildDefaultContent,
  copperOre,
  copperSword,
  copperSwordRecipe,
  slimeGel,
  smithingSkill,
  trainingSword,
} from "../../src/content/index";
import {
  attrDefs,
  basicAttackTalent,
  forestCombatZone,
  forestLocation,
  loadFixtureContent,
  mineLocation,
  testOreItem,
  testVein,
  testXpCurve,
} from "../fixtures/content";


const liveSessions: GameSession[] = [];

function createSession(initialLocationId: string): GameSession {
  const content = loadFixtureContent();
  content.starting = {
    heroes: [
      {
        id: "hero.session",
        name: "Session Hero",
        xpCurve: testXpCurve,
        knownTalents: [basicAttackTalent.id],
      },
    ],
    initialLocationId: initialLocationId as never,
  };

  const session = createGameSession({ content, seed: 42 });
  session.setSpeedMultiplier(0);
  session.resetToFresh();
  liveSessions.push(session);
  return session;
}

function createDefaultSession() {
  const content = buildDefaultContent();
  const session = createGameSession({ content, seed: 42 });
  session.setSpeedMultiplier(0);
  session.resetToFresh();
  liveSessions.push(session);
  return { session, content };
}


describe("GameSession location flow", () => {
  beforeEach(() => {
    resetContent();
  });

  afterEach(() => {
    while (liveSessions.length > 0) {
      liveSessions.pop()!.dispose();
    }
    resetContent();
  });

  test("fresh sessions default future battles to turn mode", () => {
    const session = createSession(forestLocation.id);
    const cc = session.getFocusedCharacter();

    expect(session.getBattleSchedulerMode()).toBe("turn");

    cc.startFight(forestCombatZone.id);
    session.engine.step(COMBAT_ZONE_RECOVERY_RULES.searchTicks + 1);

    expect(session.state.battles.length).toBeGreaterThan(0);
    expect(session.state.battles[0]!.scheduler.kind).toBe("turn");
  });

  test("resetToFresh restores the default battle scheduler mode", () => {
    const session = createSession(forestLocation.id);

    session.setBattleSchedulerMode("atb");
    expect(session.getBattleSchedulerMode()).toBe("atb");

    session.resetToFresh();

    expect(session.getBattleSchedulerMode()).toBe("turn");
  });

  test("stopActivity tears down the current instance but keeps the chosen location", () => {
    const session = createSession(forestLocation.id);
    const cc = session.getFocusedCharacter();


    cc.startFight(forestCombatZone.id);

    const stageId = cc.hero.stageId!;
    for (
      let i = 0;
      i < COMBAT_ZONE_RECOVERY_RULES.searchTicks + 20
        && (session.state.stages[stageId]?.spawnedActorIds.length ?? 0) === 0;
      i++
    ) {
      session.engine.step(1);
    }

    const spawnedIds = session.state.stages[stageId]?.spawnedActorIds.slice() ?? [];

    expect(spawnedIds.length).toBeGreaterThan(0);
    expect(session.state.actors.some((a) => a.kind === "enemy")).toBe(true);

    cc.stopActivity();

    expect(cc.hero.locationId).toBe(forestLocation.id);
    expect(cc.activity).toBeNull();
    expect(cc.hero.stageId).toBeNull();
    expect(session.state.actors.some((a) => a.kind === "enemy")).toBe(false);
    for (const actorId of spawnedIds) {
      expect(session.state.actors.find((a) => a.id === actorId)).toBeUndefined();
    }
  });

  test("startGather binds to the spawned resource-node actor and begins swinging", () => {
    const session = createSession(mineLocation.id);
    const cc = session.getFocusedCharacter();

    cc.startGather(testVein.id);

    expect(cc.activity?.kind).toBe(ACTIVITY_GATHER_KIND);
    if (!cc.activity || cc.activity.kind !== ACTIVITY_GATHER_KIND) {
      throw new Error("expected gather activity to be active");
    }

    const gather = cc.activity;
    expect(gather.nodeId).not.toBe(testVein.id);
    expect(gather.nodeId).toMatch(/^node\.test_vein\.[0-9A-Za-z]{5}$/);

    const nodeActor = session.state.actors.find((a) => a.id === gather.nodeId);
    expect(nodeActor).toBeDefined();
    expect(nodeActor && isResourceNode(nodeActor)).toBe(true);

    session.engine.step(testVein.swingTicks);

    const hero = cc.hero;
    expect(hero).not.toBeNull();
    expect(gather.swingsCompleted).toBeGreaterThanOrEqual(1);
    expect(
      countItem(session.state.inventories[hero.id]!, testOreItem.id),
    ).toBeGreaterThan(0);
  });

  test("loadFromSave continues runtime ids without colliding with existing instances", () => {
    const session = createSession(forestLocation.id);
    const cc = session.getFocusedCharacter();

    cc.startFight(forestCombatZone.id);
    session.engine.step(COMBAT_ZONE_RECOVERY_RULES.searchTicks + 1);


    const firstStageId = cc.hero.stageId!;
    const firstStage = session.state.stages[firstStageId]!;
    expect(firstStageId).toMatch(/^stage\.[0-9A-Za-z]{5}$/);
    expect(firstStage.spawnedActorIds.length).toBeGreaterThan(0);
    expect(session.state.battles.length).toBeGreaterThan(0);

    const firstIds = new Set<string>([
      firstStageId,
      ...firstStage.spawnedActorIds,
      ...session.state.battles.map((battle) => battle.id),
    ]);

    const loaded = deserialize(serialize(session.state), { attrDefs });
    session.loadFromSave(loaded);

    const rehydrated = session.getFocusedCharacter();
    rehydrated.stopActivity();
    rehydrated.startFight(forestCombatZone.id);
    session.engine.step(COMBAT_ZONE_RECOVERY_RULES.searchTicks + 1);


    const secondStageId = rehydrated.hero.stageId!;
    const secondStage = session.state.stages[secondStageId]!;
    expect(secondStageId).toMatch(/^stage\.[0-9A-Za-z]{5}$/);
    expect(session.state.battles.length).toBeGreaterThan(0);
    expect(session.state.battles[0]!.id).toMatch(/^battle\.[0-9A-Za-z]{5}$/);

    const secondIds = [
      secondStageId,
      ...secondStage.spawnedActorIds,
      ...session.state.battles.map((battle) => battle.id),
    ];
    for (const id of secondIds) {
      expect(firstIds.has(id)).toBe(false);
    }
    for (const actorId of secondStage.spawnedActorIds) {
      expect(actorId).toMatch(/^monster\.[A-Za-z0-9_.]+\.[0-9A-Za-z]{5}$/);
    }
  });

  test("fresh hero starts with starter weapon auto-equipped and can unequip/re-equip it", () => {
    const { session, content } = createDefaultSession();
    // 骑士开局自动装备训练木剑
    const cc = session.getCharacter("hero.knight");
    const hero = cc.hero;
    const inventory = session.state.inventories[hero.id]!;

    // 开局应已装备，背包里没有
    expect(hero.equipped.weapon?.itemId).toBe(trainingSword.id);
    expect(
      inventory.slots.some(
        (slot) => slot?.kind === "gear" && slot.instance.itemId === trainingSword.id,
      ),
    ).toBe(false);

    const weaponAtkEquipped = getAttr(hero, ATTR.WEAPON_ATK, content.attributes);

    // 卸下武器后 WEAPON_ATK 应回落到 defaultBase，剑回到背包
    cc.unequipItem("weapon");
    expect(hero.equipped.weapon ?? null).toBeNull();
    expect(getAttr(hero, ATTR.WEAPON_ATK, content.attributes)).toBeLessThan(weaponAtkEquipped);
    const backpackSlot = inventory.slots.findIndex(
      (slot) => slot?.kind === "gear" && slot.instance.itemId === trainingSword.id,
    );
    expect(backpackSlot).toBeGreaterThanOrEqual(0);

    // 重新装备后恢复原值
    cc.equipItem(backpackSlot);
    expect(hero.equipped.weapon?.itemId).toBe(trainingSword.id);
    expect(getAttr(hero, ATTR.WEAPON_ATK, content.attributes)).toBe(weaponAtkEquipped);
  });

  test("craftRecipe consumes materials, grants smithing XP, and produces the crafted weapon", () => {
    const { session } = createDefaultSession();
    const cc = session.getCharacter("hero.knight");
    const hero = cc.hero;

    const inventory = session.state.inventories[hero.id]!;
    addStack(inventory, copperOre.id, 3, 99);
    addStack(inventory, slimeGel.id, 2, 99);

    cc.craftRecipe(copperSwordRecipe.id);

    expect(countItem(inventory, copperOre.id)).toBe(0);
    expect(countItem(inventory, slimeGel.id)).toBe(0);
    expect(hero.skills[smithingSkill.id]?.xp).toBe(copperSwordRecipe.xpReward);
    expect(
      inventory.slots.some(
        (slot) => slot?.kind === "gear" && slot.instance.itemId === copperSword.id,
      ),
    ).toBe(true);
  });

  test("purchaseUpgrade is routed through session and appends player-facing logs", () => {
    const { session } = createDefaultSession();
    session.state.currencies["currency.gold"] = 1000;

    session.purchaseUpgrade("upgrade.combat.atk");

    expect(session.state.worldRecord.upgrades["upgrade.combat.atk"]).toBe(1);
    expect(
      session.state.gameLog.some((entry) =>
        entry.text.includes("购买了全局升级“") && entry.text.includes("Lv.1"),
      ),
    ).toBe(true);

    expect(
      session.state.gameLog.some((entry) => entry.text.includes("升级购买")),
    ).toBe(true);
  });

  test("multiple heroes can exist and be focused independently", () => {
    const { session } = createDefaultSession();
    const heroes = session.listHeroes();
    expect(heroes.length).toBe(4);

    expect(session.focusedCharId).toBe("hero.knight");
    session.setFocusedChar("hero.ranger");
    expect(session.focusedCharId).toBe("hero.ranger");

    const cc1 = session.getCharacter("hero.knight");
    const cc2 = session.getCharacter("hero.ranger");
    expect(cc1.hero.name).toBe("骑士");
    expect(cc2.hero.name).toBe("游侠");
  });
});


import { describe, expect, test } from "bun:test";
import {
  emptyContentDb,
  type QuestDef,
  type QuestId,
  type ItemId,
} from "../../../src/core/content";
import { createGameSession } from "../../../src/core/session";
import { testCharXpCurve, attrDefs, testOreItem } from "../../fixtures/content";

function q(id: string, def: Omit<QuestDef, "id">): QuestDef {
  return { id: id as QuestId, ...def };
}

function makeContent(quests: Record<string, QuestDef>) {
  const content = emptyContentDb();
  content.attributes = attrDefs;
  content.starting = {
    heroes: [
      {
        id: "hero.test",
        name: "Test Hero",
        xpCurve: testCharXpCurve,
        knownTalents: [],
      },
    ],
    initialLocationId: "location.test" as never,
  };
  content.locations = {
    "location.test": {
      id: "location.test" as never,
      name: "Test Location",
      entries: [],
    },
  };
  content.quests = quests;
  return content;
}

describe("quest/tracker", () => {
  test("accept → event progress → auto complete → rewards granted", () => {
    const quest = q("quest.test.kill", {
      name: "Kill Quest",
      description: "Kill 2 monsters.",
      objectives: [
        {
          kind: "event",
          description: "Kill 2 monsters",
          eventType: "kill",
          targetCount: 2,
        },
      ],
      rewards: {
        currencies: { "currency.gold": 100 },
      },
    });
    const content = makeContent({ [quest.id]: quest });

    const session = createGameSession({ content, seed: 1 });
    session.setSpeedMultiplier(0);
    session.resetToFresh();

    // Accept quest
    session.acceptQuest(quest.id);
    const inst1 = session.getQuestInstance(quest.id);
    expect(inst1).toBeDefined();
    expect(inst1!.status).toBe("active");
    expect(inst1!.progress).toEqual([0]);

    // Emit kill events
    const completedEvents: string[] = [];
    session.bus.on("questCompleted", (p) => completedEvents.push(p.questId));

    session.bus.emit("kill", { attackerId: "", victimId: "enemy:1" });
    expect(session.getQuestInstance(quest.id)!.progress[0]).toBe(1);

    session.bus.emit("kill", { attackerId: "", victimId: "enemy:2" });
    // Should be auto-completed (turnIn.mode defaults to auto)
    expect(session.getQuestInstance(quest.id)!.status).toBe("completed");
    expect(completedEvents).toContain(quest.id);

    // Reward should have been granted
    expect(session.state.currencies["currency.gold"]).toBe(100);

    session.dispose();
  });

  test("event objective with filter only counts matching events", () => {
    const quest = q("quest.test.slime", {
      name: "Slime Hunt",
      description: "Kill 2 slimes.",
      objectives: [
        {
          kind: "event",
          description: "Kill 2 slimes",
          eventType: "kill",
          filter: { field: "defId", op: "eq", value: "monster.slime" },
          targetCount: 2,
        },
      ],
      rewards: { currencies: { "currency.gold": 50 } },
    });
    const content = makeContent({ [quest.id]: quest });

    const session = createGameSession({ content, seed: 1 });
    session.setSpeedMultiplier(0);
    session.resetToFresh();
    session.acceptQuest(quest.id);

    // Kill a non-slime — should NOT count
    session.bus.emit("kill", { attackerId: "", victimId: "enemy:1", defId: "monster.goblin" });
    expect(session.getQuestInstance(quest.id)!.progress[0]).toBe(0);

    // Kill slimes
    session.bus.emit("kill", { attackerId: "", victimId: "enemy:2", defId: "monster.slime" });
    expect(session.getQuestInstance(quest.id)!.progress[0]).toBe(1);

    session.bus.emit("kill", { attackerId: "", victimId: "enemy:3", defId: "monster.slime" });
    expect(session.getQuestInstance(quest.id)!.status).toBe("completed");
    expect(session.state.currencies["currency.gold"]).toBe(50);

    session.dispose();
  });

  test("manual turnIn requires explicit call and applies cost", () => {
    const quest = q("quest.test.manual", {
      name: "Collect Ore",
      description: "Have 3 ore and turn in.",
      objectives: [
        {
          kind: "event",
          description: "Mine 3 ore",
          eventType: "loot",
          filter: { field: "itemId", op: "eq", value: testOreItem.id },
          incrementField: "qty",
          targetCount: 3,
        },
      ],
      turnIn: {
        mode: "manual",
        cost: {
          items: [{ itemId: testOreItem.id, qty: 3 }],
        },
      },
      rewards: { currencies: { "currency.gold": 200 } },
    });
    const content = makeContent({ [quest.id]: quest });
    content.items = { [testOreItem.id]: testOreItem };

    const session = createGameSession({ content, seed: 1 });
    session.setSpeedMultiplier(0);
    session.resetToFresh();
    session.acceptQuest(quest.id);

    // Give player some ore
    session.debugGiveItem("hero.test", testOreItem.id, 5);

    // Simulate loot events
    session.bus.emit("loot", { charId: "hero.test", itemId: testOreItem.id, qty: 2 });
    expect(session.getQuestInstance(quest.id)!.progress[0]).toBe(2);
    expect(session.getQuestInstance(quest.id)!.status).toBe("active");

    session.bus.emit("loot", { charId: "hero.test", itemId: testOreItem.id, qty: 1 });
    // Should be "ready" — NOT auto-completed
    expect(session.getQuestInstance(quest.id)!.status).toBe("ready");

    // Turn in
    session.turnInQuest(quest.id);
    expect(session.getQuestInstance(quest.id)!.status).toBe("completed");
    expect(session.state.currencies["currency.gold"]).toBe(200);

    session.dispose();
  });

  test("autoAccept quest is accepted on fresh start when no prerequisites", () => {
    const quest = q("quest.test.auto", {
      name: "Auto Quest",
      description: "Auto accepted.",
      autoAccept: true,
      objectives: [
        { kind: "event", description: "Kill 1", eventType: "kill", targetCount: 1 },
      ],
      rewards: { currencies: { "currency.gold": 10 } },
    });
    const content = makeContent({ [quest.id]: quest });

    const session = createGameSession({ content, seed: 1 });
    session.setSpeedMultiplier(0);
    session.resetToFresh();

    // Should already be accepted from reeval()
    const inst = session.getQuestInstance(quest.id);
    expect(inst).toBeDefined();
    expect(inst!.status).toBe("active");

    session.dispose();
  });

  test("repeatable quest can be completed multiple times", () => {
    const quest = q("quest.test.repeat", {
      name: "Daily",
      description: "Kill 1.",
      autoAccept: true,
      repeatable: true,
      objectives: [
        { kind: "event", description: "Kill 1", eventType: "kill", targetCount: 1 },
      ],
      rewards: { currencies: { "currency.gold": 10 } },
    });
    const content = makeContent({ [quest.id]: quest });

    const session = createGameSession({ content, seed: 1 });
    session.setSpeedMultiplier(0);
    session.resetToFresh();

    expect(session.getQuestInstance(quest.id)!.status).toBe("active");

    // Complete once
    session.bus.emit("kill", { attackerId: "", victimId: "e:1" });

    // After completion of repeatable + autoAccept, tracker immediately re-accepts.
    const instAfterKill = session.getQuestInstance(quest.id)!;
    expect(instAfterKill.status).toBe("active"); // re-accepted
    expect(instAfterKill.completionCount).toBe(1);
    expect(instAfterKill.progress).toEqual([0]);
    expect(session.state.currencies["currency.gold"]).toBe(10);

    // Complete second time
    session.bus.emit("kill", { attackerId: "", victimId: "e:2" });
    expect(session.getQuestInstance(quest.id)!.status).toBe("active");
    expect(session.getQuestInstance(quest.id)!.completionCount).toBe(2);
    expect(session.state.currencies["currency.gold"]).toBe(20);

    session.dispose();
  });

  test("abandon resets quest and makes it available again", () => {
    const quest = q("quest.test.abandon", {
      name: "Abandon Test",
      description: "Abandon me.",
      objectives: [
        { kind: "event", description: "Kill 5", eventType: "kill", targetCount: 5 },
      ],
    });
    const content = makeContent({ [quest.id]: quest });

    const session = createGameSession({ content, seed: 1 });
    session.setSpeedMultiplier(0);
    session.resetToFresh();
    session.acceptQuest(quest.id);

    session.bus.emit("kill", { attackerId: "", victimId: "e:1" });
    expect(session.getQuestInstance(quest.id)!.progress[0]).toBe(1);

    session.abandonQuest(quest.id);
    expect(session.getQuestInstance(quest.id)).toBeUndefined();

    // Should appear in available again
    expect(session.getAvailableQuests()).toContain(quest.id);

    session.dispose();
  });
});

import { describe, test, expect, beforeEach } from "bun:test";
import {
  deserialize,
  InMemorySaveAdapter,
  SAVE_VERSION,
  serialize,
} from "../../src/core/save";
import { createEmptyState } from "../../src/core/infra/state";
import { createBattle } from "../../src/core/combat/battle";
import { INTENT, registerBuiltinIntents } from "../../src/core/combat/intent";
import { resetContent } from "../../src/core/content";
import { loadFixtureContent, makePlayer, makeSlime, attrDefs } from "../fixtures/content";
import { ATTR } from "../../src/core/entity/attribute";
import { getAttr, isCharacter, isEnemy, isPlayer } from "../../src/core/entity/actor";

describe("save / serialize+deserialize", () => {
  beforeEach(() => {
    resetContent();
    loadFixtureContent();
    registerBuiltinIntents();
  });

  test("round-trips an empty state", () => {
    const state = createEmptyState(123, 1);
    const raw = serialize(state);
    const restored = deserialize(raw, { attrDefs });
    expect(restored.rngSeed).toBe(123);
    expect(restored.rngState).toBe(123);
    expect(restored.actors).toEqual([]);
    expect(restored.battles).toEqual([]);
  });

  test("round-trips player-facing game log entries", () => {
    const state = createEmptyState(123, 1);
    state.gameLog.push({
      tick: 12,
      category: "economy",
      text: "购买了全局升级\u201c战士训练\u201d Lv.1，消耗 100 金币。",
    });

    const raw = serialize(state);
    const restored = deserialize(raw, { attrDefs });

    expect(restored.gameLog).toEqual(state.gameLog);
  });

  test("throws when gameLog field is missing", () => {
    const state = createEmptyState(123, 1);
    const payload = JSON.parse(serialize(state)) as { version: number; state: Record<string, unknown> };
    delete payload.state.gameLog;

    expect(() => deserialize(JSON.stringify(payload), { attrDefs })).toThrow();
  });

  test("round-trips PC level / exp / currentHp / xpCurve", () => {

    const state = createEmptyState(42, 1);
    const hero = makePlayer({
      id: "hero.1",
      maxHp: 120,
      inventoryStackLimit: 12,
    });
    hero.level = 5;
    hero.exp = 42;
    hero.currentHp = 73;
    state.actors.push(hero);

    const raw = serialize(state);
    const restored = deserialize(raw, { attrDefs });
    const loaded = restored.actors[0]!;
    if (!isPlayer(loaded)) throw new Error("expected player");
    expect(loaded.currentHp).toBe(73);
    expect(loaded.level).toBe(5);
    expect(loaded.exp).toBe(42);
    expect(getAttr(loaded, ATTR.INVENTORY_STACK_LIMIT, attrDefs)).toBe(12);
  });

  test("strips derived attr modifiers — rebuilt from SoT on load", () => {
    const state = createEmptyState(0, 1);
    const hero = makePlayer({ id: "hero.1", maxHp: 100 });
    // Simulate a stale modifier stack that wasn't rebuilt yet. These should
    // be discarded by serialize.
    hero.attrs.modifiers = [
      { stat: ATTR.MAX_HP, op: "flat", value: 999, sourceId: "stale" },
    ];
    hero.attrs.cache = { [ATTR.MAX_HP]: 999_999 }; // also stale
    state.actors.push(hero);

    const raw = serialize(state);
    // Confirm JSON does not contain the stale source.
    expect(raw).not.toContain("stale");
    expect(raw).not.toContain("999999");

    const restored = deserialize(raw, { attrDefs });
    const loaded = restored.actors[0]!;
    if (!isCharacter(loaded)) throw new Error("not a character");
    expect(loaded.attrs.modifiers).toEqual([]);
  });

  test("clamps currentHp if maxHp has been lowered between saves", () => {
    const state = createEmptyState(0, 1);
    const hero = makePlayer({ id: "hero.1", maxHp: 200 });
    hero.currentHp = 180;
    state.actors.push(hero);
    // Mimic a retroactive content nerf: the serialized base is now 80.
    hero.attrs.base[ATTR.MAX_HP] = 80;

    const raw = serialize(state);
    const restored = deserialize(raw, { attrDefs });
    const loaded = restored.actors[0]!;
    if (!isCharacter(loaded)) throw new Error("not a character");
    expect(loaded.currentHp).toBe(80);
  });

  test("round-trips a Battle + Enemy instance", () => {
    const state = createEmptyState(7, 1);
    const hero = makePlayer({ id: "hero.1" });
    const slime = makeSlime("enemy.slime.w1.0");
    slime.currentHp = 17;
    state.actors.push(hero, slime);

    const battle = createBattle({
      id: "battle.test",
      mode: "solo",
      participantIds: [hero.id, slime.id],
      startedAtTick: 10,
      intents: {
        [hero.id]: INTENT.RANDOM_ATTACK,
        [slime.id]: INTENT.RANDOM_ATTACK,
      },
    });
    state.battles.push(battle);

    const raw = serialize(state);
    const restored = deserialize(raw, { attrDefs });

    expect(restored.battles.length).toBe(1);
    const b = restored.battles[0]!;
    expect(b.id).toBe("battle.test");
    expect(b.participantIds).toEqual([hero.id, slime.id]);
    expect(b.scheduler.kind).toBe("atb");
    expect(b.intents[hero.id]).toBe(INTENT.RANDOM_ATTACK);

    // Enemy was restored with knownTalentIds re-populated from its MonsterDef.
    const restoredSlime = restored.actors.find((a) => a.id === slime.id)!;
    if (!isEnemy(restoredSlime)) throw new Error("expected enemy");
    expect(restoredSlime.knownTalentIds.length).toBeGreaterThan(0);
    expect(restoredSlime.currentHp).toBe(17);
  });



  test("version mismatch throws when no migration exists", () => {
    const bad = JSON.stringify({ version: SAVE_VERSION + 99, state: {} });
    expect(() => deserialize(bad, { attrDefs })).toThrow();
  });

  test("adapter round-trips raw data", async () => {
    const adapter = new InMemorySaveAdapter();
    await adapter.save("k", "hello");
    expect(await adapter.load("k")).toBe("hello");
    await adapter.remove("k");
    expect(await adapter.load("k")).toBe(null);
  });
});

import { describe, test, expect, beforeEach } from "bun:test";
import {
  createEnemy,
  createPlayerCharacter,
  getAttr,
  isAlive,
  isCharacter,
  isEnemy,
  isPlayer,
  rebuildCharacterDerived,
  type Enemy,
  type PlayerCharacter,
} from "../../../src/core/entity/actor";
import { ATTR } from "../../../src/core/entity/attribute";
import { resetContent, patchContent } from "../../../src/core/content";
import type { ItemDef, ItemId, Modifier } from "../../../src/core/content/types";
import type { GearInstance } from "../../../src/core/item";
import {
  basicAttackTalent,
  loadFixtureContent,
  slimeMonster,
  testXpCurve,
} from "../../fixtures/content";

const copperSword: ItemDef = {
  id: "item.weapon.copper_sword" as ItemId,
  name: "Copper Sword",
  stackable: false,
  slot: "weapon",
  modifiers: [
    { stat: ATTR.PATK, op: "flat", value: 5, sourceId: "" },
  ],
};

function makeSwordInstance(
  instanceId = "gear.test.sword1",
  rolledMods: Modifier[] = [],
): GearInstance {
  return { instanceId, itemId: copperSword.id, rolledMods };
}

describe("actor hierarchy", () => {
  beforeEach(() => {
    resetContent();
    loadFixtureContent();
    patchContent({ items: { [copperSword.id]: copperSword } });
  });

  test("createPlayerCharacter produces a full PlayerCharacter", () => {
    const pc = createPlayerCharacter({
      id: "p1",
      name: "Hero",
      knownTalents: [basicAttackTalent.id],
      baseAttrs: { [ATTR.PATK]: 7, [ATTR.MAX_HP]: 120 },
      xpCurve: testXpCurve,
    });
    expect(pc.kind).toBe("player");
    expect(pc.level).toBe(1);
    expect(pc.exp).toBe(0);
    expect(pc.currentHp).toBe(120); // starts full
    expect(pc.knownTalentIds).toEqual([basicAttackTalent.id]);
    expect(getAttr(pc, ATTR.PATK)).toBe(7);
  });

  test("createEnemy produces a full Enemy from MonsterDef", () => {
    const e = createEnemy({
      instanceId: "enemy.slime#1",
      def: slimeMonster,
    });
    expect(e.kind).toBe("enemy");
    expect(e.defId).toBe(slimeMonster.id);
    expect(e.currentHp).toBe(30);
    expect(e.knownTalentIds).toEqual(slimeMonster.talents);
  });

  test("type guards distinguish actor kinds", () => {
    const pc: PlayerCharacter = createPlayerCharacter({
      id: "p",
      name: "p",
      xpCurve: testXpCurve,
    });
    const en: Enemy = createEnemy({
      instanceId: "e1",
      def: slimeMonster,
    });
    expect(isCharacter(pc)).toBe(true);
    expect(isCharacter(en)).toBe(true);
    expect(isPlayer(pc)).toBe(true);
    expect(isPlayer(en)).toBe(false);
    expect(isEnemy(en)).toBe(true);
    expect(isEnemy(pc)).toBe(false);
    expect(isAlive(pc)).toBe(true);
    en.currentHp = 0;
    expect(isAlive(en)).toBe(false);
  });

  test("equipping a modifier item increases the derived attr after rebuild", () => {
    const pc = createPlayerCharacter({
      id: "p",
      name: "p",
      baseAttrs: { [ATTR.PATK]: 10, [ATTR.MAX_HP]: 100 },
      xpCurve: testXpCurve,
    });
    expect(getAttr(pc, ATTR.PATK)).toBe(10);

    pc.equipped = { weapon: makeSwordInstance() };
    rebuildCharacterDerived(pc);

    expect(getAttr(pc, ATTR.PATK)).toBe(15);
  });

  test("rebuildCharacterDerived is idempotent", () => {
    const pc = createPlayerCharacter({
      id: "p",
      name: "p",
      baseAttrs: { [ATTR.PATK]: 10, [ATTR.MAX_HP]: 100 },
      equipped: { weapon: makeSwordInstance() },
      xpCurve: testXpCurve,
    });
    const after1 = getAttr(pc, ATTR.PATK);
    rebuildCharacterDerived(pc);
    rebuildCharacterDerived(pc);
    expect(getAttr(pc, ATTR.PATK)).toBe(after1);
    // Modifier stack should not duplicate on repeated rebuild.
    expect(pc.attrs.modifiers.length).toBe(1);
  });

  test("rebuildCharacterDerived clamps currentHp if maxHp dropped", () => {
    const pc = createPlayerCharacter({
      id: "p",
      name: "p",
      baseAttrs: { [ATTR.MAX_HP]: 200 },
      xpCurve: testXpCurve,
    });
    expect(pc.currentHp).toBe(200);

    // Simulate a save in which maxHp was larger than current attrs now allow.
    pc.attrs.base[ATTR.MAX_HP] = 80;
    rebuildCharacterDerived(pc);
    expect(pc.currentHp).toBe(80);
  });

  test("equipped GearInstance contributes def.modifiers + rolledMods", () => {
    const pc = createPlayerCharacter({
      id: "p",
      name: "p",
      baseAttrs: { [ATTR.PATK]: 10, [ATTR.MAX_HP]: 100 },
      xpCurve: testXpCurve,
    });
    // def.modifiers grants +5 ATK; rolledMods piles on an additional +3.
    pc.equipped = {
      weapon: makeSwordInstance("gear.test.rolled", [
        { stat: ATTR.PATK, op: "flat", value: 3, sourceId: "gear.roll" },
      ]),
    };
    rebuildCharacterDerived(pc);
    expect(getAttr(pc, ATTR.PATK)).toBe(18);
  });
});

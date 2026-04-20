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
} from "../../src/core/actor";
import { ATTR } from "../../src/core/attribute";
import { resetContent, patchContent } from "../../src/core/content";
import type { ItemDef, ItemId } from "../../src/core/content/types";
import {
  attrDefs,
  basicAttackAbility,
  loadFixtureContent,
  slimeMonster,
} from "../fixtures/content";

const copperSword: ItemDef = {
  id: "item.weapon.copper_sword" as ItemId,
  name: "Copper Sword",
  stackable: false,
  slot: "weapon",
  modifiers: [
    { stat: ATTR.ATK, op: "flat", value: 5, sourceId: "" },
  ],
};

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
      knownAbilities: [basicAttackAbility.id],
      baseAttrs: { [ATTR.ATK]: 7, [ATTR.MAX_HP]: 120 },
      attrDefs,
    });
    expect(pc.kind).toBe("player");
    expect(pc.level).toBe(1);
    expect(pc.exp).toBe(0);
    expect(pc.currentHp).toBe(120); // starts full
    expect(pc.abilities).toEqual([basicAttackAbility.id]);
    expect(getAttr(pc, ATTR.ATK, attrDefs)).toBe(7);
  });

  test("createEnemy produces a full Enemy from MonsterDef", () => {
    const e = createEnemy({
      instanceId: "enemy.slime#1",
      def: slimeMonster,
      attrDefs,
    });
    expect(e.kind).toBe("enemy");
    expect(e.defId).toBe(slimeMonster.id);
    expect(e.currentHp).toBe(30);
    expect(e.abilities).toEqual(slimeMonster.abilities);
  });

  test("type guards distinguish actor kinds", () => {
    const pc: PlayerCharacter = createPlayerCharacter({
      id: "p",
      name: "p",
      attrDefs,
    });
    const en: Enemy = createEnemy({
      instanceId: "e1",
      def: slimeMonster,
      attrDefs,
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
      baseAttrs: { [ATTR.ATK]: 10, [ATTR.MAX_HP]: 100 },
      attrDefs,
    });
    expect(getAttr(pc, ATTR.ATK, attrDefs)).toBe(10);

    pc.equipped = { weapon: copperSword.id };
    rebuildCharacterDerived(pc, attrDefs);

    expect(getAttr(pc, ATTR.ATK, attrDefs)).toBe(15);
  });

  test("rebuildCharacterDerived is idempotent", () => {
    const pc = createPlayerCharacter({
      id: "p",
      name: "p",
      baseAttrs: { [ATTR.ATK]: 10, [ATTR.MAX_HP]: 100 },
      equipped: { weapon: copperSword.id },
      attrDefs,
    });
    const after1 = getAttr(pc, ATTR.ATK, attrDefs);
    rebuildCharacterDerived(pc, attrDefs);
    rebuildCharacterDerived(pc, attrDefs);
    expect(getAttr(pc, ATTR.ATK, attrDefs)).toBe(after1);
    // Modifier stack should not duplicate on repeated rebuild.
    expect(pc.attrs.modifiers.length).toBe(1);
  });

  test("rebuildCharacterDerived clamps currentHp if maxHp dropped", () => {
    const pc = createPlayerCharacter({
      id: "p",
      name: "p",
      baseAttrs: { [ATTR.MAX_HP]: 200 },
      attrDefs,
    });
    expect(pc.currentHp).toBe(200);

    // Simulate a save in which maxHp was larger than current attrs now allow.
    pc.attrs.base[ATTR.MAX_HP] = 80;
    rebuildCharacterDerived(pc, attrDefs);
    expect(pc.currentHp).toBe(80);
  });
});

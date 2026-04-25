import { describe, expect, test } from "bun:test";
import { ATTR } from "../../src/core/entity/attribute";
import {
  DEFAULT_CONTENT,
  buildDefaultContent,
  copperSword,
  getDefaultContent,
  magicBasicAttackTalent,
  trainingSword,
} from "../../src/content";
import { compileInheritedCollection } from "../../src/content/compiler/inheritance";

describe("default content", () => {
  test("buildDefaultContent returns the module singleton", () => {
    expect(buildDefaultContent()).toBe(DEFAULT_CONTENT);
    expect(getDefaultContent()).toBe(DEFAULT_CONTENT);
  });

  test("abstract templates do not leak into runtime content", () => {
    expect(DEFAULT_CONTENT.items["item.template.weapon.base"]).toBeUndefined();
    expect(DEFAULT_CONTENT.monsters["monster.template.base"]).toBeUndefined();
    expect(DEFAULT_CONTENT.starting?.heroes.some((hero) => hero.id.startsWith("hero.template."))).toBe(false);
  });

  test("derived definitions are materialized before runtime consumption", () => {
    expect(trainingSword.slot).toBe("weapon");
    expect(trainingSword.stackable).toBe(false);
    expect(copperSword.tags).toEqual(["weapon", "sword", "crafted"]);

    const cleric = DEFAULT_CONTENT.starting?.heroes.find((hero) => hero.id === "hero.cleric");
    expect(cleric?.knownTalents).toEqual([magicBasicAttackTalent.id]);
    expect(cleric?.baseAttrs?.[ATTR.WEAPON_MATK]).toBe(1);
    expect(cleric?.baseAttrs?.[ATTR.MRES]).toBe(0.2);
  });
});

describe("compileInheritedCollection", () => {
  test("deep merges objects, replaces arrays, and omits abstract defs", () => {
    const compiled = compileInheritedCollection<{
      id: string;
      name?: string;
      tags?: string[];
      stats?: { hp?: number; mp?: number };
    }>({
      bucketName: "test",
      defs: {
        "tpl.base": {
          id: "tpl.base",
          abstract: true,
          name: "Base",
          tags: ["base"],
          stats: { hp: 10, mp: 5 },
        },
        "item.child": {
          id: "item.child",
          extends: "tpl.base",
          tags: ["child"],
          stats: { hp: 20 },
        },
      },
    });

    expect(compiled).toEqual({
      "item.child": {
        id: "item.child",
        name: "Base",
        tags: ["child"],
        stats: { hp: 20, mp: 5 },
      },
    });
  });

  test("throws on circular inheritance", () => {
    expect(() =>
      compileInheritedCollection<{ id: string }>({
        bucketName: "test",
        defs: {
          a: { id: "a", extends: "b" },
          b: { id: "b", extends: "a" },
        },
      }),
    ).toThrow(/circular inheritance/);
  });
});

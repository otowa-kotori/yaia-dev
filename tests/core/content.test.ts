import { describe, test, expect, beforeEach } from "bun:test";
import {
  emptyContentDb,
  getContent,
  getItem,
  patchContent,
  resetContent,
  setContent,
  type ItemDef,
  type ItemId,
} from "../../src/core/content";

const copper: ItemDef = {
  id: "item.ore.copper" as ItemId,
  name: "Copper Ore",
  stackable: true,
};

const iron: ItemDef = {
  id: "item.ore.iron" as ItemId,
  name: "Iron Ore",
  stackable: true,
};

describe("content registry", () => {
  beforeEach(() => resetContent());

  test("starts empty", () => {
    expect(getContent()).toEqual(emptyContentDb());
  });

  test("setContent replaces the whole db", () => {
    setContent({
      ...emptyContentDb(),
      items: { [copper.id]: copper },
    });
    expect(getItem("item.ore.copper")).toBe(copper);
  });

  test("patchContent merges without dropping existing entries", () => {
    patchContent({ items: { [copper.id]: copper } });
    patchContent({ items: { [iron.id]: iron } });
    expect(getItem("item.ore.copper")).toBe(copper);
    expect(getItem("item.ore.iron")).toBe(iron);
  });

  test("getters throw on missing ids", () => {
    expect(() => getItem("item.does.not.exist")).toThrow();
  });
});

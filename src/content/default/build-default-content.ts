import type { ContentDb } from "../../core/content";
import { emptyContentDb } from "../../core/content";
import { attrDefs } from "./attributes";
import { combatZones } from "./combat-zones";
import { dungeons } from "./dungeons";
import { effects } from "./effects";
import { formulas } from "./formulas";
import { startingConfig } from "./heroes";
import { items } from "./items";
import { locations } from "./locations";
import { monsters } from "./monsters";
import { recipes } from "./recipes";
import { resourceNodes } from "./resource-nodes";
import { skills } from "./skills";
import { talents } from "./talents";
import { upgrades } from "./upgrades";

const defaultContent: ContentDb = {
  ...emptyContentDb(),
  attributes: attrDefs,
  combatZones,
  dungeons,
  effects,
  formulas,
  items,
  locations,
  monsters,
  recipes,
  resourceNodes,
  skills,
  starting: startingConfig,
  talents,
  upgrades,
};

export const DEFAULT_CONTENT = defaultContent;

export function getDefaultContent(): ContentDb {
  return defaultContent;
}

export function buildDefaultContent(): ContentDb {
  return defaultContent;
}

import type { AttrDef } from "../content/types";
import { getAttr, type Character } from "./actor";
import { ATTR } from "./attribute";

export function applyTickResourceRegen(
  actor: Character,
  attrDefs: Readonly<Record<string, AttrDef>>,
): void {
  if (actor.currentHp <= 0) return;

  const maxHp = Math.max(0, getAttr(actor, ATTR.MAX_HP, attrDefs));
  const maxMp = Math.max(0, getAttr(actor, ATTR.MAX_MP, attrDefs));
  const hpRegen = Math.max(0, getAttr(actor, ATTR.HP_REGEN, attrDefs));
  const mpRegen = Math.max(0, getAttr(actor, ATTR.MP_REGEN, attrDefs));

  actor.currentHp = clamp(actor.currentHp + hpRegen, 0, maxHp);
  actor.currentMp = clamp(actor.currentMp + mpRegen, 0, maxMp);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

import { getAttr, type Character } from "./actor";
import { ATTR } from "./attribute";

/**
 * Raw per-logic-tick resource regen.
 *
 * Used by non-battle activity phases whose recovery is explicitly defined in
 * logic ticks (search, rest, respawn windows, etc.).
 */
export function applyTickResourceRegen(
  actor: Character,
): void {
  applyScaledResourceRegen(actor, 1);
}

/**
 * Apply current HP/MP regen attributes scaled by an arbitrary time-basis factor.
 *
 * Battle uses this to map the same regen attribute onto different scheduler
 * clocks: ATB spreads regen across a reference self-turn; turn mode grants it
 * once per completed global round.
 */
export function applyScaledResourceRegen(
  actor: Character,
  scale: number,
): void {
  if (actor.currentHp <= 0) return;
  if (!Number.isFinite(scale) || scale <= 0) return;

  const maxHp = Math.max(0, getAttr(actor, ATTR.MAX_HP));
  const maxMp = Math.max(0, getAttr(actor, ATTR.MAX_MP));
  const hpRegen = Math.max(0, getAttr(actor, ATTR.HP_REGEN));
  const mpRegen = Math.max(0, getAttr(actor, ATTR.MP_REGEN));

  actor.currentHp = clamp(actor.currentHp + hpRegen * scale, 0, maxHp);
  actor.currentMp = clamp(actor.currentMp + mpRegen * scale, 0, maxMp);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

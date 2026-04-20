// Effect pipeline.
//
// Three flavors of EffectDef.kind:
//   instant  - resolve once on apply (damage/heal/rewards), no persistence.
//   duration - install modifiers on the target for `durationTicks` ticks; when
//              expired, remove them. No periodic firing.
//   periodic - like duration, but also fires an instant-like pulse every
//              `periodTicks` ticks. Useful for DoTs / regen / crop growth.
//
// Modifiers from duration/periodic effects are tagged with sourceId =
// "effect:<effectId>:<sourceActorId>:<appliedAtTick>" so that on expiration we
// can remove the right stack via removeModifiersBySource.

import type { EffectDef, AttrDef, ItemId } from "../content/types";
import { getEffect, getItem, getSkill } from "../content/registry";
import { evalFormula, type FormulaContext } from "../formula";
import type { Rng } from "../rng";
import type { GameEventBus } from "../events";
import type { ActiveEffect, GameState } from "../state/types";
import type { Character, PlayerCharacter } from "../actor";
import { getAttr, isPlayer } from "../actor";
import { addModifiers, ATTR, removeModifiersBySource } from "../attribute";
import { grantCharacterXp, grantSkillXp } from "../progression";
import { addStack, addGear } from "../inventory";
import { getInventoryStackLimit } from "../inventory/stack-limit";
import { createGearInstance } from "../item";

export interface EffectContext {
  state: GameState;
  bus: GameEventBus;
  rng: Rng;
  attrDefs: Readonly<Record<string, AttrDef>>;
  /** Current logic tick; used to timestamp applied-at markers and compute cooldown/expiry. */
  currentTick: number;
}

/**
 * Apply an effect from `source` onto `target`. Returns the resulting magnitude
 * (damage dealt / hp healed / 0 for non-magnitude effects).
 */
export function applyEffect(
  effect: EffectDef,
  source: Character,
  target: Character,
  ctx: EffectContext,
): number {
  switch (effect.kind) {
    case "instant":
      return applyInstantPulse(effect, source, target, ctx);

    case "duration":
      installTimedEffect(effect, source, target, ctx);
      return 0;

    case "periodic":
      installTimedEffect(effect, source, target, ctx);
      return 0;
  }
}

/** Install a duration/periodic effect on the target. */
function installTimedEffect(
  effect: EffectDef,
  source: Character,
  target: Character,
  ctx: EffectContext,
): void {
  const duration = effect.durationTicks ?? 0;
  if (duration <= 0) {
    throw new Error(
      `effect "${effect.id}" of kind "${effect.kind}" has no durationTicks`,
    );
  }
  const sourceId = activeEffectSourceId(effect.id, source.id, ctx.currentTick);

  const ae: ActiveEffect = {
    effectId: effect.id,
    sourceId,
    remainingTicks: duration,
  };
  target.activeEffects.push(ae);

  if (effect.modifiers && effect.modifiers.length > 0) {
    // Tag modifiers with the per-instance sourceId so expiry can remove them cleanly.
    addModifiers(
      target.attrs,
      effect.modifiers.map((m) => ({ ...m, sourceId })),
    );
  }
}

/** Resolve an "instant pulse" — damage/heal/rewards computed from formula. */
function applyInstantPulse(
  effect: EffectDef,
  source: Character,
  target: Character,
  ctx: EffectContext,
): number {
  let magnitude = 0;

  if (effect.formula) {
    const fctx = buildFormulaContext(source, target, ctx.attrDefs);
    magnitude = Math.max(0, Math.floor(evalFormula(effect.formula, fctx)));
  }

  const mode = effect.magnitudeMode;
  if (mode === "damage" && magnitude > 0) {
    target.currentHp = Math.max(0, target.currentHp - magnitude);
    ctx.bus.emit("damage", {
      attackerId: source.id,
      targetId: target.id,
      amount: magnitude,
    });
  } else if (mode === "heal" && magnitude > 0) {
    const maxHp = getAttr(target, ATTR.MAX_HP, ctx.attrDefs);
    target.currentHp = Math.min(maxHp, target.currentHp + magnitude);
  }

  if (effect.rewards) applyRewards(effect, target, ctx);
  return magnitude;
}

/** Grant items / XP rewards to the character (if target is a player). */
function applyRewards(
  effect: EffectDef,
  target: Character,
  ctx: EffectContext,
): void {
  const rewards = effect.rewards;
  if (!rewards) return;
  if (!isPlayer(target)) return; // Monsters don't collect rewards.
  const charId = target.id;
  const pc = target as PlayerCharacter;

  if (rewards.items?.length) {
    for (const { itemId, qty } of rewards.items) {
      addItemToInventory(ctx, charId, itemId, qty);
      ctx.bus.emit("loot", { charId, itemId, qty });
    }
  }

  if (rewards.xp?.length) {
    for (const { skillId, amount } of rewards.xp) {
      const skillDef = getSkill(skillId);
      grantSkillXp(pc, skillDef, amount, { bus: ctx.bus });
    }
  }

  if (rewards.charXp) {
    grantCharacterXp(pc, rewards.charXp, { bus: ctx.bus });
  }
}

// Dispatch into the per-item-class inventory API:
//   - stackable items merge into an existing stack or claim a new slot.
//   - non-stackable (gear) items run through createGearInstance(qty times) so
//     every copy gets its own instanceId + rolled affixes. The same rng used
//     everywhere for gameplay randomness feeds the roll, keeping save-state
//     determinism intact.
//
// Policy: the per-char inventory must already exist (created on hero spawn /
// after load). No silent fallback; missing inventory is a bug — throw.
function addItemToInventory(
  ctx: EffectContext,
  charId: string,
  itemId: ItemId,
  qty: number,
): void {
  const inv = ctx.state.inventories[charId];
  if (!inv) {
    throw new Error(
      `addItemToInventory: no inventory for charId "${charId}". Hero spawn should have created one.`,
    );
  }
  const def = getItem(itemId);
  if (def.stackable) {
    addStack(inv, itemId, qty, getInventoryStackLimit(ctx.state, charId, ctx.attrDefs));
    return;
  }
  for (let i = 0; i < qty; i++) {
    const gear = createGearInstance(itemId, { rng: ctx.rng });
    addGear(inv, gear);
  }
}

function buildFormulaContext(
  source: Character,
  target: Character,
  attrDefs: Readonly<Record<string, AttrDef>>,
): FormulaContext {
  // Variables available to formulas. Names here are part of the FORMULA
  // DATA CONTRACT — designers reference them by string in content JSON
  // (e.g. `{ kind: "linear", xVar: "target_def" }`). Treat these names as
  // stable; renaming is a content migration, not a refactor. Source-side
  // attrs are raw names ("atk", "def"); target-side are prefixed with
  // "target_" so authors can read both.
  return {
    vars: {
      atk: getAttr(source, ATTR.ATK, attrDefs),
      def: getAttr(target, ATTR.DEF, attrDefs),
      source_atk: getAttr(source, ATTR.ATK, attrDefs),
      source_int: getAttr(source, ATTR.INT, attrDefs),
      source_str: getAttr(source, ATTR.STR, attrDefs),
      source_dex: getAttr(source, ATTR.DEX, attrDefs),
      source_wis: getAttr(source, ATTR.WIS, attrDefs),
      source_max_hp: getAttr(source, ATTR.MAX_HP, attrDefs),
      source_current_hp: source.currentHp,
      target_max_hp: getAttr(target, ATTR.MAX_HP, attrDefs),
      target_current_hp: target.currentHp,
      target_def: getAttr(target, ATTR.DEF, attrDefs),
    },
  };
}

// ---------- Ticking active effects ----------

export interface TickActiveEffectsContext {
  attrDefs: Readonly<Record<string, AttrDef>>;
  bus: GameEventBus;
  state: GameState;
  rng: Rng;
  currentTick: number;
}

/**
 * Advance all active effects on a character by 1 tick. Fires periodic pulses
 * if due, removes expired effects (along with their modifier contributions).
 *
 * For simplicity (and to avoid dangling refs across a save), the periodic
 * pulse treats the character itself as its own source. Effects whose balance
 * depends on the original caster's stats should compute their magnitude at
 * install time and store it as a Modifier, not re-evaluate per pulse.
 */
export function tickActiveEffects(
  c: Character,
  ctx: TickActiveEffectsContext,
): void {
  if (c.activeEffects.length === 0) return;

  // Snapshot to tolerate expiry-driven mutation mid-iteration.
  const snapshot = [...c.activeEffects];

  for (const ae of snapshot) {
    ae.remainingTicks -= 1;

    const def = safeGetEffect(ae.effectId);
    if (!def) continue;

    if (def.kind === "periodic") {
      const period = def.periodTicks ?? 0;
      if (period > 0) {
        // Fire a pulse whenever the remaining duration aligns with a period.
        // (So an effect with duration 6, period 2 fires at remaining 4, 2, 0.)
        const sinceInstall = (def.durationTicks ?? 0) - ae.remainingTicks;
        if (sinceInstall > 0 && sinceInstall % period === 0) {
          applyInstantPulse(def, c, c, {
            state: ctx.state,
            bus: ctx.bus,
            rng: ctx.rng,
            attrDefs: ctx.attrDefs,
            currentTick: ctx.currentTick,
          });
        }
      }
    }
  }

  // Remove expired.
  const expired = c.activeEffects.filter((ae) => ae.remainingTicks <= 0);
  if (expired.length > 0) {
    for (const ae of expired) {
      removeModifiersBySource(c.attrs, ae.sourceId);
    }
    c.activeEffects = c.activeEffects.filter((ae) => ae.remainingTicks > 0);
  }
}

function safeGetEffect(id: string): EffectDef | undefined {
  try {
    return getEffect(id);
  } catch {
    return undefined;
  }
}

function activeEffectSourceId(
  effectId: string,
  sourceActorId: string,
  appliedAtTick: number,
): string {
  return `effect:${effectId}:${sourceActorId}:${appliedAtTick}`;
}

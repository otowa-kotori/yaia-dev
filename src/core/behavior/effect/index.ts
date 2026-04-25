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

import type { EffectDef, AttrDef, ItemId } from "../../content/types";
import { getEffect, getItem, getSkill } from "../../content/registry";
import { evalFormula, type FormulaContext } from "../../infra/formula";
import type { Rng } from "../../infra/rng";
import type { CurrencyChangeSource, GameEventBus } from "../../infra/events";

import type { ActiveEffect, GameState } from "../../infra/state/types";
import type { Character, PlayerCharacter } from "../../entity/actor";
import { getAttr, isPlayer, rebuildCharacterDerived } from "../../entity/actor";
import { addModifiers, ATTR, removeModifiersBySource } from "../../entity/attribute";
import { grantCharacterXp, grantSkillXp } from "../../growth/leveling";
import { addStack, addGear } from "../../inventory";

import { getInventoryStackLimit } from "../../inventory/stack-limit";
import { createGearInstance } from "../../item";
import type { PendingLootEntry } from "../../world/stage/types";

export interface EffectContext {
  state: GameState;
  bus: GameEventBus;
  rng: Rng;
  attrDefs: Readonly<Record<string, AttrDef>>;
  /** Current logic tick; used to timestamp applied-at markers and compute cooldown/expiry. */
  currentTick: number;
  /** Optional semantic source for emitted currency change events. */
  currencyChangeSource?: CurrencyChangeSource;
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
    const healedAmount = Math.max(0, Math.min(maxHp, target.currentHp + magnitude) - target.currentHp);
    target.currentHp += healedAmount;
    if (healedAmount > 0) {
      ctx.bus.emit("heal", {
        sourceId: source.id,
        targetId: target.id,
        amount: healedAmount,
      });
    }
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
  const scope = playerLogScope(pc);

  if (rewards.items?.length) {
    for (const { itemId, qty } of rewards.items) {
      addItemToInventory(ctx, charId, itemId, qty);
      ctx.bus.emit("loot", {
        charId,
        itemId,
        qty,
        stageId: scope.stageId,
        dungeonSessionId: scope.dungeonSessionId,
      });
    }
  }


  if (rewards.xp?.length) {
    for (const { skillId, amount } of rewards.xp) {
      const skillDef = getSkill(skillId);
      grantSkillXp(pc, skillDef, amount, { bus: ctx.bus });
    }
  }

  if (rewards.charXp) {
    const levelsGained = grantCharacterXp(pc, rewards.charXp, { bus: ctx.bus });
    // 如果升了级，重建派生属性（base 已被 grantCharacterXp 修改）。
    if (levelsGained > 0) {
      rebuildCharacterDerived(pc, ctx.attrDefs, ctx.state.worldRecord);
    }
  }

  if (rewards.currencies) {
    for (const [currId, amount] of Object.entries(rewards.currencies)) {
      if (amount === 0) continue;
      const nextTotal = (ctx.state.currencies[currId] ?? 0) + amount;
      ctx.state.currencies[currId] = nextTotal;
      ctx.bus.emit("currencyChanged", {
        currencyId: currId,
        amount,
        total: nextTotal,
        source: ctx.currencyChangeSource ?? "other",
        charId,
        stageId: scope.stageId,
        dungeonSessionId: scope.dungeonSessionId,
      });
    }
  }
}


// Dispatch into the per-item-class inventory API:
//   - stackable items merge into an existing stack or claim a new slot.
//   - non-stackable (gear) items run through createGearInstance(qty times) so
//     every copy gets its own instanceId + rolled affixes. The same rng used
//     everywhere for gameplay randomness feeds the roll, keeping save-state
//     determinism intact.
//
// Overflow policy: when the hero's inventory is full, excess items are routed
// to the stage's pendingLoot queue (if the hero is in a stage). Items that
// cannot be placed anywhere are silently dropped — this should not happen in
// practice because a stage is always active when rewards flow.
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
    const stackLimit = getInventoryStackLimit(ctx.state, charId, ctx.attrDefs);
    const res = addStack(inv, itemId, qty, stackLimit);
    if (!res.ok) {
      pushToPendingLoot(ctx, charId, { kind: "stack", itemId, qty: res.remaining });
    }
    return;
  }
  for (let i = 0; i < qty; i++) {
    const gear = createGearInstance(itemId, { rng: ctx.rng });
    const res = addGear(inv, gear);
    if (!res.ok) {
      pushToPendingLoot(ctx, charId, { kind: "gear", instance: gear });
    }
  }
}

/** Route overflow items to the stage's pendingLoot for the given character.
 *  Stack entries are merged into an existing pending entry with the same itemId
 *  (pendingLoot has no stack limit — unlimited stacking).
 *  If no stage is found (shouldn't happen during normal gameplay), the item
 *  is lost — but we avoid crashing so the game loop stays alive. */
function pushToPendingLoot(
  ctx: EffectContext,
  charId: string,
  entry: PendingLootEntry,
): void {
  const hero = ctx.state.actors.find((a) => a.id === charId);
  if (!hero || !isPlayer(hero)) return;
  const stageId = hero.stageId;
  if (!stageId) return;
  const session = ctx.state.stages[stageId];
  if (!session) return;


  if (entry.kind === "stack") {
    const existing = session.pendingLoot.find(
      (e): e is PendingLootEntry & { kind: "stack" } =>
        e.kind === "stack" && e.itemId === entry.itemId,
    );
    if (existing) {
      existing.qty += entry.qty;
    } else {
      session.pendingLoot.push(entry);
    }
    ctx.bus.emit("pendingLootOverflowed", {
      charId,
      stageId,
      itemId: entry.itemId,
      qty: entry.qty,
    });
  } else {
    session.pendingLoot.push(entry);
    ctx.bus.emit("pendingLootOverflowed", {
      charId,
      stageId,
      itemId: entry.instance.itemId,
      qty: 1,
    });
  }

  ctx.bus.emit("pendingLootChanged", { charId, stageId });
}


function playerLogScope(hero: PlayerCharacter): {
  stageId?: string;
  dungeonSessionId?: string;
} {
  return {
    stageId: hero.stageId ?? undefined,
    dungeonSessionId: hero.dungeonSessionId ?? undefined,
  };
}

function buildFormulaContext(
  source: Character,
  target: Character,
  attrDefs: Readonly<Record<string, AttrDef>>,
): FormulaContext {

  // Variables available to formulas. Names here are part of the FORMULA
  // DATA CONTRACT — designers reference them by string in content JSON
  // (e.g. `{ kind: "linear", xVar: "target_def" }`). Treat these names as
  // stable; renaming is a content migration, not a refactor.
  //
  // 伤害公式变量约定：
  //   面板攻击力 / 防御来自 source/target 的导出属性；
  //   一级属性仍暴露（供非伤害公式使用，如治疗 / 采集效率）。
  return {
    vars: {
      // 物理伤害公式所需
      patk: getAttr(source, ATTR.PATK, attrDefs),
      pdef: getAttr(target, ATTR.PDEF, attrDefs),
      // 魔法伤害公式所需
      matk: getAttr(source, ATTR.MATK, attrDefs),
      mres: getAttr(target, ATTR.MRES, attrDefs),
      // 一级属性（供其他公式类型使用）
      source_str:        getAttr(source, ATTR.STR, attrDefs),
      source_dex:        getAttr(source, ATTR.DEX, attrDefs),
      source_int:        getAttr(source, ATTR.INT, attrDefs),
      source_max_hp:     getAttr(source, ATTR.MAX_HP, attrDefs),
      source_current_hp: source.currentHp,
      target_max_hp:     getAttr(target, ATTR.MAX_HP, attrDefs),
      target_current_hp: target.currentHp,
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

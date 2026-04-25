// Reaction dispatch engine.
//
// dispatchReaction(actor, event, ctx):
//   1. Collect all active effects on the actor that have a handler for event.kind
//   2. Sort by reactionPriority (lower = earlier)
//   3. Execute each handler with reentry guard
//
// Reentry guard: an effect cannot re-trigger the same event kind on itself.
// E.g. retaliation → deals damage → target's retaliation → deals damage →
// original retaliation would fire again → BLOCKED (same effectId + same kind).
//
// Depth limit: MAX_REACTION_DEPTH = 8. Alpha: throw on exceed.

import type { Character } from "../../entity/actor/types";
import type { EffectInstance } from "../../infra/state/types";
import { getEffect } from "../../content/registry";
import type { ReactionEvent, ReactionContext, ReactionHooks } from "./types";

const MAX_REACTION_DEPTH = 8;

/**
 * Dispatch a reaction event to all qualifying effects on a single actor.
 * Effects are sorted by reactionPriority; handlers execute synchronously.
 */
export function dispatchReaction(
  actor: Character,
  event: ReactionEvent,
  ctx: ReactionContext,
): void {
  if (ctx.reactionDepth >= MAX_REACTION_DEPTH) {
    throw new Error(
      `dispatchReaction: exceeded MAX_REACTION_DEPTH (${MAX_REACTION_DEPTH}) ` +
      `on event "${event.kind}" for actor "${actor.id}"`,
    );
  }

  // Collect effects that have a handler for this event kind.
  const entries: { inst: EffectInstance; handler: Function }[] = [];
  for (const inst of actor.activeEffects) {
    const def = safeGetEffect(inst.effectId);
    if (!def?.reactions) continue;
    const handler = (def.reactions as Record<string, Function | undefined>)[event.kind];
    if (handler) {
      entries.push({ inst, handler });
    }
  }

  if (entries.length === 0) return;

  // Sort by reactionPriority (ascending — lower numbers execute first).
  entries.sort((a, b) => {
    const pa = safeGetEffect(a.inst.effectId)?.reactionPriority ?? 0;
    const pb = safeGetEffect(b.inst.effectId)?.reactionPriority ?? 0;
    return pa - pb;
  });

  ctx.reactionDepth += 1;
  try {
    for (const { inst, handler } of entries) {
      // Reentry guard: same effectId + same event kind cannot self-recurse.
      const reentryKey = `${inst.effectId}:${event.kind}`;
      if (ctx.activeReactionKeys.has(reentryKey)) continue;

      ctx.activeReactionKeys.add(reentryKey);
      try {
        handler(actor, event, inst.state, ctx);
      } finally {
        ctx.activeReactionKeys.delete(reentryKey);
      }
    }
  } finally {
    ctx.reactionDepth -= 1;
  }
}

/**
 * Dispatch a broadcast reaction event to multiple actors.
 * Used for: on_ally_damaged, battle_start, battle_end, wave_end.
 */
export function dispatchBroadcastReaction(
  actors: readonly Character[],
  event: ReactionEvent,
  ctx: ReactionContext,
): void {
  for (const actor of actors) {
    dispatchReaction(actor, event, ctx);
  }
}

// ---------- Internal ----------

function safeGetEffect(id: string) {
  try {
    return getEffect(id);
  } catch {
    return undefined;
  }
}

import { isPlayer } from "../entity/actor/types";
import { ATTR, getAttr as getAttrFromSet } from "../entity/attribute";
import { getContent } from "../content/registry";
import { SHARED_INVENTORY_KEY, type GameState } from "../infra/state/types";
import { DEFAULT_SHARED_STACK_LIMIT } from "./constants";

export function getInventoryStackLimit(
  state: GameState,
  inventoryOwnerId: string,
): number | null {
  if (inventoryOwnerId === SHARED_INVENTORY_KEY) {
    return normalizeStackLimit(
      state.sharedInventoryStackLimit ?? DEFAULT_SHARED_STACK_LIMIT,
      `shared inventory stack limit`,
    );
  }

  const owner = state.actors.find((actor) => actor.id === inventoryOwnerId);
  if (!owner) {
    throw new Error(
      `getInventoryStackLimit: no actor found for inventory owner "${inventoryOwnerId}"`,
    );
  }
  if (!isPlayer(owner)) {
    throw new Error(
      `getInventoryStackLimit: actor "${inventoryOwnerId}" is not a player`,
    );
  }

  return normalizeStackLimit(
    getAttrFromSet(owner.attrs, ATTR.INVENTORY_STACK_LIMIT, getContent().attributes),
    `player inventory stack limit for "${inventoryOwnerId}"`,
  );
}

function normalizeStackLimit(
  limit: number | null,
  label: string,
): number | null {
  if (limit === null) return null;
  if (!Number.isInteger(limit) || limit <= 0) {
    throw new Error(`getInventoryStackLimit: invalid ${label}: ${String(limit)}`);
  }
  return limit;
}

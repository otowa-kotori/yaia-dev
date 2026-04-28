import {
  type ItemId,
  type RecipeDef,
  getItem,
  getRecipe,
  getSkill,
} from "../../content";
import { grantSkillXp } from "../../growth/leveling";
import {

  addGear,
  addStack,
  removeAtSlot,
  type Inventory,
} from "../../inventory";
import { getInventoryStackLimit } from "../../inventory/stack-limit";
import { type GearInstance } from "../../item";
import type { CharacterCommandSet, SessionRuntime } from "../types";
import {
  SHARED_INVENTORY_KEY,
  addItemToInventory,
  getInventoryByOwner,
  getSkillLevel,
  rebuildHeroDerived,
} from "../runtime";

/**
 * Inventory gameplay service.
 *
 * Session remains the orchestration layer, but bag/equipment/crafting logic now
 * sits in one place instead of being mixed into controller/runtime code.
 */
export function createInventoryGameplay(
  runtime: SessionRuntime,
): Pick<
  CharacterCommandSet,
  | "equipItem"
  | "unequipItem"
  | "discardInventoryItem"
  | "storeItemInShared"
  | "takeItemFromShared"
  | "craftRecipe"
  | "pickUpPendingLoot"
  | "pickUpAllPendingLoot"
> {
  function cloneInventory(inventory: Inventory): Inventory {
    return {
      capacity: inventory.capacity,
      slots: inventory.slots.map((slot) => {
        if (slot === null) return null;
        if (slot.kind === "stack") return { ...slot };
        return {
          kind: "gear",
          instance: {
            ...slot.instance,
            rolledMods: slot.instance.rolledMods.map((mod) => ({ ...mod })),
          },
        };
      }),
    };
  }

  function removeItemFromInventoryByItemId(
    inventory: Inventory,
    itemId: ItemId | string,
    qty: number,
  ): void {
    if (qty <= 0) {
      throw new Error(
        `session.removeItemFromInventoryByItemId: qty must be positive, got ${qty}`,
      );
    }

    let remaining = qty;
    for (let i = 0; i < inventory.slots.length && remaining > 0; i += 1) {
      const slot = inventory.slots[i];
      if (!slot) continue;
      const slotItemId =
        slot.kind === "stack" ? slot.itemId : slot.instance.itemId;
      if (slotItemId !== itemId) continue;
      if (slot.kind === "stack") {
        const take = Math.min(remaining, slot.qty);
        removeAtSlot(inventory, i, take);
        remaining -= take;
        continue;
      }
      removeAtSlot(inventory, i);
      remaining -= 1;
    }

    if (remaining > 0) {
      throw new Error(
        `session.removeItemFromInventoryByItemId: inventory is missing ${remaining} of "${itemId}"`,
      );
    }
  }

  function simulateRecipeInventoryChange(
    heroId: string,
    inventory: Inventory,
    recipe: RecipeDef,
  ): void {
    const draft = cloneInventory(inventory);
    for (const input of recipe.inputs) {
      removeItemFromInventoryByItemId(draft, input.itemId, input.qty);
    }
    for (const output of recipe.outputs) {
      const def = getItem(output.itemId);
      if (def.stackable) {
        const result = addStack(
          draft,
          output.itemId,
          output.qty,
          getInventoryStackLimit(runtime.state, heroId),
        );
        if (!result.ok) {
          throw new Error(
            `session.simulateRecipeInventoryChange: inventory full, cannot fit recipe output "${output.itemId}"`,
          );
        }
        continue;
      }

      for (let i = 0; i < output.qty; i += 1) {
        const result = addGear(draft, {
          instanceId: `preview.${recipe.id}.${i}`,
          itemId: output.itemId,
          rolledMods: [],
        } satisfies GearInstance);
        if (!result.ok) {
          throw new Error(
            `session.simulateRecipeInventoryChange: inventory full, cannot fit recipe output gear "${output.itemId}"`,
          );
        }
      }
    }
  }

  function simulateAddSlotToInventory(
    inventoryOwnerId: string,
    inventory: Inventory,
    slot: NonNullable<Inventory["slots"][number]>,
    actionLabel: string,
  ): void {
    if (slot.kind === "stack") {
      const result = addStack(
        inventory,
        slot.itemId,
        slot.qty,
        getInventoryStackLimit(runtime.state, inventoryOwnerId),
      );
      if (!result.ok) {
        throw new Error(
          `${actionLabel}: inventory full for "${inventoryOwnerId}", cannot fit stack "${slot.itemId}" (remaining=${result.remaining})`,
        );
      }
      return;
    }

    const result = addGear(inventory, slot.instance);
    if (!result.ok) {
      throw new Error(
        `${actionLabel}: inventory full for "${inventoryOwnerId}", cannot fit gear "${slot.instance.itemId}"`,
      );
    }
  }

  function transferInventorySlot(
    charId: string,
    fromInventoryOwnerId: string,
    toInventoryOwnerId: string,
    slotIndex: number,
  ): void {
    if (fromInventoryOwnerId === toInventoryOwnerId) {
      throw new Error(
        `session.transferInventorySlot: source and target inventory are both "${fromInventoryOwnerId}"`,
      );
    }

    const sourceInventory = getInventoryByOwner(runtime, fromInventoryOwnerId);
    const targetInventory = getInventoryByOwner(runtime, toInventoryOwnerId);
    const sourceSlot = sourceInventory.slots[slotIndex];
    if (!sourceSlot) {
      throw new Error(
        `session.transferInventorySlot: slot ${slotIndex} is empty in inventory "${fromInventoryOwnerId}"`,
      );
    }

    simulateAddSlotToInventory(
      toInventoryOwnerId,
      cloneInventory(targetInventory),
      sourceSlot,
      "session.transferInventorySlot",
    );

    const removed = removeAtSlot(sourceInventory, slotIndex);
    simulateAddSlotToInventory(
      toInventoryOwnerId,
      targetInventory,
      removed,
      "session.transferInventorySlot(commit)",
    );

    const itemId =
      removed.kind === "stack" ? removed.itemId : removed.instance.itemId;
    const qty = removed.kind === "stack" ? removed.qty : 1;

    runtime.bus.emit("inventoryTransferred", {
      charId,
      itemId,
      qty,
      fromInventoryId: fromInventoryOwnerId,
      toInventoryId: toInventoryOwnerId,
    });
    runtime.bus.emit("inventoryChanged", {
      charId,
      inventoryId: fromInventoryOwnerId,
    });
    runtime.bus.emit("inventoryChanged", {
      charId,
      inventoryId: toInventoryOwnerId,
    });
  }

  function discardInventorySlot(
    charId: string,
    inventoryOwnerId: string,
    slotIndex: number,
  ): void {
    const inventory = getInventoryByOwner(runtime, inventoryOwnerId);
    const slot = inventory.slots[slotIndex];
    if (!slot) {
      throw new Error(
        `session.discardInventorySlot: slot ${slotIndex} is empty in inventory "${inventoryOwnerId}"`,
      );
    }

    const removed = removeAtSlot(inventory, slotIndex);
    runtime.bus.emit("inventoryDiscarded", {
      charId,
      inventoryId: inventoryOwnerId,
      itemId:
        removed.kind === "stack" ? removed.itemId : removed.instance.itemId,
      qty: removed.kind === "stack" ? removed.qty : 1,
    });
    runtime.bus.emit("inventoryChanged", {
      charId,
      inventoryId: inventoryOwnerId,
    });
  }

  return {
    equipItem(cc, slotIndex) {
      const hero = cc.hero;
      const inventory = getInventoryByOwner(runtime, hero.id);
      const slot = inventory.slots[slotIndex];
      if (!slot) {
        throw new Error(`session.equipItem: slot ${slotIndex} is empty`);
      }
      if (slot.kind !== "gear") {
        throw new Error(
          `session.equipItem: slot ${slotIndex} does not contain gear`,
        );
      }

      const def = getItem(slot.instance.itemId);
      if (!def.slot) {
        throw new Error(
          `session.equipItem: item "${slot.instance.itemId}" is not equippable`,
        );
      }

      const removed = removeAtSlot(inventory, slotIndex);
      if (removed.kind !== "gear") {
        throw new Error("session.equipItem: expected gear removal result");
      }

      const previous = hero.equipped[def.slot] ?? null;
      hero.equipped[def.slot] = removed.instance;
      if (previous) {
        inventory.slots[slotIndex] = { kind: "gear", instance: previous };
      }

      rebuildHeroDerived(runtime, hero);
      runtime.bus.emit("equipmentUpdated", {
        charId: hero.id,
        slot: def.slot,
        itemId: removed.instance.itemId,
        action: "equip",
      });
      runtime.bus.emit("equipmentChanged", {
        charId: hero.id,
        slot: def.slot,
      });
    },

    unequipItem(cc, slot) {
      const hero = cc.hero;
      const equipped = hero.equipped[slot] ?? null;
      if (!equipped) {
        throw new Error(`session.unequipItem: slot "${slot}" is empty`);
      }
      const unequippedItemId = equipped.itemId;
      const result = addGear(getInventoryByOwner(runtime, hero.id), equipped);
      if (!result.ok) {
        throw new Error(
          `session.unequipItem: inventory full, cannot unequip "${equipped.itemId}" from slot "${slot}"`,
        );
      }
      hero.equipped[slot] = null;
      rebuildHeroDerived(runtime, hero);
      runtime.bus.emit("equipmentUpdated", {
        charId: hero.id,
        slot,
        itemId: unequippedItemId,
        action: "unequip",
      });
      runtime.bus.emit("equipmentChanged", { charId: hero.id, slot });
    },

    discardInventoryItem(cc, inventoryOwnerId, slotIndex) {
      discardInventorySlot(cc.hero.id, inventoryOwnerId, slotIndex);
    },

    storeItemInShared(cc, slotIndex) {
      transferInventorySlot(
        cc.hero.id,
        cc.hero.id,
        SHARED_INVENTORY_KEY,
        slotIndex,
      );
    },

    takeItemFromShared(cc, slotIndex) {
      transferInventorySlot(
        cc.hero.id,
        SHARED_INVENTORY_KEY,
        cc.hero.id,
        slotIndex,
      );
    },

    craftRecipe(cc, recipeId) {
      if (cc._activity) {
        throw new Error(
          "session.craftRecipe: stop the current activity before crafting",
        );
      }

      const hero = cc.hero;
      const recipe = getRecipe(recipeId);
      const skillDef = getSkill(recipe.skill);
      const currentLevel = getSkillLevel(hero, recipe.skill);
      if (currentLevel < recipe.requiredLevel) {
        throw new Error(
          `session.craftRecipe: recipe "${recipeId}" requires ${recipe.skill} level ${recipe.requiredLevel}, got ${currentLevel}`,
        );
      }

      const inventory = getInventoryByOwner(runtime, hero.id);
      simulateRecipeInventoryChange(hero.id, inventory, recipe);

      for (const input of recipe.inputs) {
        removeItemFromInventoryByItemId(inventory, input.itemId, input.qty);
      }
      for (const output of recipe.outputs) {
        addItemToInventory(runtime, hero.id, output.itemId, output.qty);
      }
      grantSkillXp(hero, skillDef, recipe.xpReward, { bus: runtime.bus });

      runtime.bus.emit("inventoryChanged", {
        charId: hero.id,
        inventoryId: hero.id,
      });
      runtime.bus.emit("crafted", { charId: hero.id, recipeId });
    },


    pickUpPendingLoot(cc, index) {
      const session = cc.stageSession;
      if (!session) return false;
      if (index < 0 || index >= session.pendingLoot.length) return false;

      const entry = session.pendingLoot[index]!;
      const hero = cc.hero;
      const stageId = hero.stageId;
      if (!stageId) {
        throw new Error(
          "session.pickUpPendingLoot: pending loot exists without hero.stageId",
        );
      }
      const inventory = getInventoryByOwner(runtime, hero.id);

      if (entry.kind === "stack") {
        const result = addStack(
          inventory,
          entry.itemId,
          entry.qty,
          getInventoryStackLimit(runtime.state, hero.id),
        );
        if (!result.ok) return false;
      } else {
        const result = addGear(inventory, entry.instance);
        if (!result.ok) return false;
      }

      session.pendingLoot.splice(index, 1);
      runtime.bus.emit("pendingLootPicked", {
        charId: hero.id,
        stageId,
        itemId: entry.kind === "stack" ? entry.itemId : entry.instance.itemId,
        qty: entry.kind === "stack" ? entry.qty : 1,
      });
      runtime.bus.emit("inventoryChanged", {
        charId: hero.id,
        inventoryId: hero.id,
      });
      runtime.bus.emit("pendingLootChanged", { charId: hero.id, stageId });
      return true;
    },

    pickUpAllPendingLoot(cc) {
      const session = cc.stageSession;
      if (!session) return 0;

      const hero = cc.hero;
      const stageId = hero.stageId;
      if (!stageId) return session.pendingLoot.length;
      const inventory = getInventoryByOwner(runtime, hero.id);
      const before = session.pendingLoot.length;
      const kept: typeof session.pendingLoot = [];

      for (const entry of session.pendingLoot) {
        if (entry.kind === "stack") {
          const result = addStack(
            inventory,
            entry.itemId,
            entry.qty,
            getInventoryStackLimit(runtime.state, hero.id),
          );
          const pickedQty = result.ok ? entry.qty : entry.qty - result.remaining;
          if (pickedQty > 0) {
            runtime.bus.emit("pendingLootPicked", {
              charId: hero.id,
              stageId,
              itemId: entry.itemId,
              qty: pickedQty,
            });
          }
          if (!result.ok) {
            kept.push({
              kind: "stack",
              itemId: entry.itemId,
              qty: result.remaining,
            });
            continue;
          }
        } else {
          const result = addGear(inventory, entry.instance);
          if (!result.ok) {
            kept.push(entry);
            continue;
          }
          runtime.bus.emit("pendingLootPicked", {
            charId: hero.id,
            stageId,
            itemId: entry.instance.itemId,
            qty: 1,
          });
        }
      }

      session.pendingLoot = kept;
      if (kept.length < before) {
        runtime.bus.emit("inventoryChanged", {
          charId: hero.id,
          inventoryId: hero.id,
        });
        runtime.bus.emit("pendingLootChanged", { charId: hero.id, stageId });
      }
      return kept.length;
    },
  };
}

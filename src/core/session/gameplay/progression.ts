import { xpCostToReach, grantCharacterXp } from "../../growth/leveling";
import { allocateTalentPoint, equipTalent as equipTalentCore, unequipTalent as unequipTalentCore } from "../../growth/talent";
import {
  isUnlocked as isUnlockedCore,
  listUnlocked as listUnlockedCore,
  unlock as unlockCore,
} from "../../growth/unlock";
import { purchaseUpgrade as purchaseUpgradeCore } from "../../growth/upgrade-manager";
import { getUnlock } from "../../content";
import type { PlayerCharacter } from "../../entity/actor";
import type { CharacterCommandSet, SessionRuntime } from "../types";
import {
  addItemToInventory,
  getHeroControllerOrThrow,
  rebuildHeroDerived,
} from "../runtime";

export interface ProgressionGameplay {
  readonly characterCommands: Pick<
    CharacterCommandSet,
    "allocateTalent" | "equipTalent" | "unequipTalent"
  >;
  purchaseUpgrade(upgradeId: string): void;
  isUnlocked(unlockId: string): boolean;
  unlock(unlockId: string, source?: string): boolean;
  listUnlocked(): string[];
  debugGrantHeroLevels(charId: string, levels: number): number;
  debugGiveItem(charId: string, itemId: string, qty: number): void;
}

/** Global progression / unlock / debug commands. */
export function createProgressionGameplay(
  runtime: SessionRuntime,
): ProgressionGameplay {
  function computeXpForLevelGain(
    hero: PlayerCharacter,
    levels: number,
  ): number {
    if (!Number.isInteger(levels) || levels <= 0) {
      throw new Error(
        `session.debugGrantHeroLevels: levels must be a positive integer, got ${levels}`,
      );
    }

    let totalXp = 0;
    let virtualLevel = hero.level;
    let carriedExp = hero.exp;

    for (let i = 0; i < levels && virtualLevel < hero.maxLevel; i += 1) {
      const cost = xpCostToReach(virtualLevel + 1, hero.xpCurve);
      totalXp += Math.max(0, cost - carriedExp);
      virtualLevel += 1;
      carriedExp = 0;
    }

    return totalXp;
  }

  function assertKnownUnlock(unlockId: string): void {
    getUnlock(unlockId);
  }

  return {
    characterCommands: {
      allocateTalent(cc, talentId) {
        const result = allocateTalentPoint(
          cc.hero,
          talentId as never,
          runtime.content,
        );
        if (!result.ok) {
          throw new Error(
            `session.allocateTalent: ${result.reason} for talent "${talentId}"`,
          );
        }
        runtime.bus.emit("talentAllocated", {
          charId: cc.hero.id,
          talentId,
          newLevel: result.newLevel,
        });
      },

      equipTalent(cc, talentId) {
        const result = equipTalentCore(
          cc.hero,
          talentId as never,
          runtime.content,
        );
        if (!result.ok) {
          throw new Error(
            `session.equipTalent: ${result.reason} for talent "${talentId}"`,
          );
        }
      },

      unequipTalent(cc, talentId) {
        const result = unequipTalentCore(
          cc.hero,
          talentId as never,
          runtime.content,
        );
        if (!result.ok) {
          throw new Error(
            `session.unequipTalent: ${result.reason} for talent "${talentId}"`,
          );
        }
      },
    },

    purchaseUpgrade(upgradeId) {
      const result = purchaseUpgradeCore(upgradeId, {
        state: runtime.state,
        content: runtime.content,
      });
      if (!result.success) return;

      if (result.cost !== 0) {
        runtime.bus.emit("currencyChanged", {
          currencyId: result.costCurrency,
          amount: -result.cost,
          total: runtime.state.currencies[result.costCurrency] ?? 0,
          source: "upgrade_purchase",
        });
      }
      runtime.bus.emit("upgradePurchased", {
        upgradeId,
        level: result.level,
        costCurrency: result.costCurrency,
        cost: result.cost,
      });
    },

    isUnlocked(unlockId) {
      assertKnownUnlock(unlockId);
      return isUnlockedCore(runtime.state, unlockId);
    },

    unlock(unlockId, source = "system") {
      assertKnownUnlock(unlockId);
      const result = unlockCore(runtime.state, unlockId);
      if (!result.changed) return false;
      runtime.bus.emit("unlocked", {
        unlockId,
        source,
        tick: runtime.engine.currentTick,
      });
      return true;
    },

    listUnlocked() {
      return listUnlockedCore(runtime.state);
    },

    debugGrantHeroLevels(charId, levels) {
      const hero = getHeroControllerOrThrow(runtime, charId).hero;
      const totalXp = computeXpForLevelGain(hero, levels);
      if (totalXp <= 0) return 0;

      const gained = grantCharacterXp(hero, totalXp, { bus: runtime.bus });
      if (gained > 0) {
        rebuildHeroDerived(runtime, hero);
      }
      return gained;
    },

    debugGiveItem(charId, itemId, qty) {
      if (!Number.isInteger(qty) || qty <= 0) {
        throw new Error(
          `session.debugGiveItem: qty must be a positive integer, got ${qty}`,
        );
      }

      const hero = getHeroControllerOrThrow(runtime, charId).hero;
      addItemToInventory(runtime, hero.id, itemId, qty);
      runtime.bus.emit("inventoryChanged", {
        charId: hero.id,
        inventoryId: hero.id,
      });
    },
  };
}

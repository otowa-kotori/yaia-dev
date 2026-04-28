import type { UnlockDef, UnlockId } from "../../core/content";

function createUnlock(id: string, name: string, description?: string, defaultUnlocked = false): UnlockDef {
  return {
    id: id as UnlockId,
    name,
    description,
    defaultUnlocked,
  };
}

export const unlockLocationTwilight = createUnlock(
  "unlock.location.twilight",
  "解锁地点：暮色林地",
  "允许前往暮色林地。",
);

export const unlockLocationIronMine = createUnlock(
  "unlock.location.mine.ironfang",
  "解锁地点：铁牙矿坑",
  "允许前往铁牙矿坑。",
);

export const unlockLocationBossSanctum = createUnlock(
  "unlock.location.boss.blackfang",
  "解锁地点：黑牙兽巢",
  "允许前往黑牙兽巢。",
);

export const unlockLocationTraining = createUnlock(
  "unlock.location.training",
  "解锁地点：训练场",
  "允许前往训练场。",
);

export const unlockFeatureUpgradesTab = createUnlock(
  "unlock.feature.tab.upgrades",
  "解锁功能：全局升级页签",
  "显示全局升级面板。",
);

export const unlocks: Record<string, UnlockDef> = {
  [unlockLocationTwilight.id]: unlockLocationTwilight,
  [unlockLocationIronMine.id]: unlockLocationIronMine,
  [unlockLocationBossSanctum.id]: unlockLocationBossSanctum,
  [unlockLocationTraining.id]: unlockLocationTraining,
  [unlockFeatureUpgradesTab.id]: unlockFeatureUpgradesTab,
};

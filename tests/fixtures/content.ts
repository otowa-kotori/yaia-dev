import { ATTR } from "../../src/core/entity/attribute";
import { emptyContentDb, setContent, type ContentDb } from "../../src/core/content";
import type {
  TalentDef,
  TalentId,
  AttrDef,
  AttrId,
  EffectDef,
  EffectId,
  CombatZoneDef,
  CombatZoneId,
  DungeonDef,
  DungeonId,
  ItemDef,
  ItemId,
  LocationDef,
  LocationId,
  MonsterDef,
  MonsterId,
  ResourceNodeDef,
  ResourceNodeId,
  SkillDef,
  SkillId,
} from "../../src/core/content/types";
import { createGameEventBus } from "../../src/core/infra/events";
import type { GameEventBus } from "../../src/core/infra/events";
import { createRng, type Rng } from "../../src/core/infra/rng";
import { createEmptyState, type GameState } from "../../src/core/infra/state";
import { SAVE_VERSION } from "../../src/core/save/migrations";
import {
  createEnemy,
  createPlayerCharacter,
  type Enemy,
  type PlayerCharacter,
} from "../../src/core/entity/actor";
import type { FormulaRef } from "../../src/core/infra/formula";
import { registerBuiltinIntents } from "../../src/core/combat/intent";
import { DEFAULT_CHAR_STACK_LIMIT } from "../../src/core/inventory";

// ---------- Shared attribute definitions ----------
// 测试 fixture 只注册测试用到的属性；完整属性链（PATK/MATK 等）
// 在需要战斗伤害的测试里再 patchContent 补入。

export const attrDefs: Record<string, AttrDef> = {
  [ATTR.MAX_HP]: {
    id: ATTR.MAX_HP,
    name: "Max HP",
    defaultBase: 100,
    integer: true,
    clampMin: 0,
  },
  [ATTR.MAX_MP]: {
    id: ATTR.MAX_MP,
    name: "Max MP",
    defaultBase: 20,
    integer: true,
    clampMin: 0,
  },
  [ATTR.HP_REGEN]: {
    id: ATTR.HP_REGEN,
    name: "HP Regen",
    defaultBase: 0,
    clampMin: 0,
  },
  [ATTR.MP_REGEN]: {
    id: ATTR.MP_REGEN,
    name: "MP Regen",
    defaultBase: 0,
    clampMin: 0,
  },
  [ATTR.OUT_OF_COMBAT_HP_PCT_PER_SECOND]: {
    id: ATTR.OUT_OF_COMBAT_HP_PCT_PER_SECOND,
    name: "Out-of-combat HP pct/sec",
    defaultBase: 0,
    clampMin: 0,
  },
  [ATTR.OUT_OF_COMBAT_MP_PCT_PER_SECOND]: {
    id: ATTR.OUT_OF_COMBAT_MP_PCT_PER_SECOND,
    name: "Out-of-combat MP pct/sec",
    defaultBase: 0,
    clampMin: 0,
  },
  [ATTR.PATK]: {

    id: ATTR.PATK,
    name: "PATK",
    defaultBase: 10,
    integer: true,
    clampMin: 0,
  },
  [ATTR.PDEF]: {
    id: ATTR.PDEF,
    name: "PDEF",
    defaultBase: 0,
    integer: true,
    clampMin: 0,
  },
  [ATTR.SPEED]: {
    id: ATTR.SPEED,
    name: "Speed",
    defaultBase: 40,
    integer: true,
    clampMin: 1,
  },
  [ATTR.INVENTORY_STACK_LIMIT]: {
    id: ATTR.INVENTORY_STACK_LIMIT,
    name: "Inventory Stack Limit",
    defaultBase: DEFAULT_CHAR_STACK_LIMIT,
    integer: true,
    clampMin: 1,
  },
};

// ---------- Common fixture effects ----------

export const basicStrikeEffect: EffectDef = {
  id: "effect.combat.strike" as EffectId,
  kind: "instant",
  magnitudeMode: "damage",
  formula: { kind: "phys_damage_v1" },
};

export const burnDotEffect: EffectDef = {
  id: "effect.combat.burn" as EffectId,
  kind: "periodic",
  durationActions: 6,
  periodActions: 2,
  magnitudeMode: "damage",
  formula: { kind: "constant", value: 3 },
};

export const shieldBuffEffect: EffectDef = {
  id: "effect.buff.shield" as EffectId,
  kind: "duration",
  durationActions: 10,
  modifiers: [
    { stat: ATTR.PDEF, op: "flat", value: 5, sourceId: "" },
  ],
};

export const phaseRecoveryEffect: EffectDef = {
  id: "effect.system.phase_recovery" as EffectId,
  kind: "duration",
  computeModifiers: (state) => {
    const hpRegen = Math.max(0, Number(state.hpRegen ?? 0));
    const mpRegen = Math.max(0, Number(state.mpRegen ?? 0));
    return [
      { stat: ATTR.HP_REGEN, op: "flat" as const, value: hpRegen, sourceId: "" },
      { stat: ATTR.MP_REGEN, op: "flat" as const, value: mpRegen, sourceId: "" },
    ].filter((modifier) => modifier.value > 0);
  },
};

export const outOfCombatRecoveryEffect: EffectDef = {
  id: "effect.system.out_of_combat_recovery" as EffectId,
  kind: "duration",
  modifiers: [
    {
      stat: ATTR.OUT_OF_COMBAT_HP_PCT_PER_SECOND,
      op: "flat",
      value: 0.02,
      sourceId: "",
    },
    {
      stat: ATTR.OUT_OF_COMBAT_MP_PCT_PER_SECOND,
      op: "flat",
      value: 0.02,
      sourceId: "",
    },
  ],
};

export const combatSearchRecoveryEffect: EffectDef = {
  ...outOfCombatRecoveryEffect,
  id: "effect.system.combat_search_recovery" as EffectId,
};

export const dungeonWaveRestRecoveryEffect: EffectDef = {
  ...outOfCombatRecoveryEffect,
  id: "effect.system.dungeon_wave_rest_recovery" as EffectId,
  modifiers: [
    {
      stat: ATTR.OUT_OF_COMBAT_HP_PCT_PER_SECOND,
      op: "flat",
      value: 0.075,
      sourceId: "",
    },
    {
      stat: ATTR.OUT_OF_COMBAT_MP_PCT_PER_SECOND,
      op: "flat",
      value: 0.075,
      sourceId: "",
    },
  ],
};

// ---------- Common fixture talents ----------


export const basicAttackTalent: TalentDef = {
  id: "talent.basic.attack" as TalentId,
  name: "Attack",
  type: "active",
  maxLevel: 1,
  tpCost: 0,
  getActiveParams: () => ({
    targetKind: "single_enemy" as const,
  }),
  effects: [basicStrikeEffect.id],
};


export const fireballTalent: TalentDef = {
  id: "talent.fire.fireball" as TalentId,
  name: "Fireball",
  type: "active",
  maxLevel: 1,
  tpCost: 0,
  getActiveParams: () => ({
    mpCost: 5,
    cooldownActions: 3,
    targetKind: "single_enemy" as const,
  }),

  effects: [basicStrikeEffect.id, burnDotEffect.id],
};

export const shieldSelfTalent: TalentDef = {
  id: "talent.buff.shield_self" as TalentId,
  name: "Shield",
  type: "active",
  maxLevel: 1,
  tpCost: 0,
  getActiveParams: () => ({
    targetKind: "self" as const,
  }),
  effects: [shieldBuffEffect.id],
};


// ---------- Common fixture monsters ----------

export const slimeMonster: MonsterDef = {
  id: "monster.slime" as MonsterId,
  name: "Slime",
  level: 1,
  baseAttrs: {
    [ATTR.MAX_HP]: 30,
    [ATTR.PATK]: 4,   // 测试 fixture 直接设 PATK，跳过 WEAPON_ATK + scaling 链路
    [ATTR.PDEF]: 1,
    [ATTR.SPEED]: 20,
  },
  talents: [basicAttackTalent.id],
  rewards: { charXp: 10 },
};

export const goblinMonster: MonsterDef = {
  id: "monster.goblin" as MonsterId,
  name: "Goblin",
  level: 1,
  baseAttrs: {
    [ATTR.MAX_HP]: 22,
    [ATTR.PATK]: 6,
    [ATTR.PDEF]: 0,
    [ATTR.SPEED]: 28,
  },
  talents: [basicAttackTalent.id],
  rewards: { charXp: 15 },
};

export const dropSlimeMonster: MonsterDef = {
  id: "monster.slime.drop" as MonsterId,
  name: "Drop Slime",
  level: 1,
  baseAttrs: {
    [ATTR.MAX_HP]: 18,
    [ATTR.PATK]: 2,
    [ATTR.PDEF]: 0,
    [ATTR.SPEED]: 10,
  },
  talents: [basicAttackTalent.id],
  rewards: {
    drops: [{ itemId: "item.kill.drop" as ItemId, chance: 1, minQty: 1, maxQty: 1 }],
  },
};

// ---------- Common fixture skills ----------


const testProgressionXpParams = {
  a: 8,
  p: 1.8,
  c: 8,
  base: 1.25,
  cap: 0.18,
  d: 0.22,
  e: 80,
  offset: 8,
};

export const testCharXpCurve: FormulaRef = {
  kind: "char_xp_curve_v1",
  ...testProgressionXpParams,
};

export const testSkillXpCurve: FormulaRef = {
  kind: "skill_xp_curve_v1",
  ...testProgressionXpParams,
};

export const testXpCurve = testCharXpCurve;

export const miningSkill: SkillDef = {
  id: "skill.mining" as SkillId,
  name: "Mining",
  xpCurve: testSkillXpCurve,
  maxLevel: 99,
};


// ---------- Common fixture items + resource nodes ----------

export const testOreItem: ItemDef = {
  id: "item.ore.test" as ItemId,
  name: "Test Ore",
  stackable: true,
};

export const waveTrophyItem: ItemDef = {
  id: "item.wave.trophy" as ItemId,
  name: "Wave Trophy",
  stackable: true,
};

export const killDropItem: ItemDef = {
  id: "item.kill.drop" as ItemId,
  name: "Kill Drop",
  stackable: true,
};

export const testVein: ResourceNodeDef = {

  id: "node.test_vein" as ResourceNodeId,
  name: "Test Vein",
  skill: miningSkill.id,
  swingTicks: 3,
  xpPerSwing: 4,
  drops: [{ itemId: testOreItem.id, chance: 1, minQty: 1, maxQty: 2 }],
};

// ---------- CombatZones ----------

export const forestCombatZone: CombatZoneDef = {
  id: "combatzone.forest.test_path" as CombatZoneId,
  name: "Test Path",
  waveSelection: "random",
  waves: [

    {
      monsters: [slimeMonster.id, slimeMonster.id],
      rewards: {
        drops: [
          { itemId: waveTrophyItem.id, chance: 1, minQty: 1, maxQty: 1 },
        ],
      },
    },
    {
      monsters: [slimeMonster.id, goblinMonster.id],
      rewards: {
        drops: [
          { itemId: waveTrophyItem.id, chance: 1, minQty: 1, maxQty: 1 },
        ],
      },
    },
  ],
};

export const dropCombatZone: CombatZoneDef = {
  id: "combatzone.forest.kill_drop" as CombatZoneId,
  name: "Kill Drop Path",
  waveSelection: "random",
  waves: [
    {
      monsters: [dropSlimeMonster.id],
    },
  ],
};


// ---------- Dungeons ----------


export const testDungeon: DungeonDef = {
  id: "dungeon.test.slime_cave" as DungeonId,
  name: "Test Slime Cave",
  waves: [

    {
      id: "dungeon.wave.0",
      name: "Slime Vanguard",
      monsters: [slimeMonster.id],
      rewards: {
        drops: [
          { itemId: waveTrophyItem.id, chance: 1, minQty: 1, maxQty: 1 },
        ],
      },
    },
    {
      id: "dungeon.wave.1",
      name: "Slime Boss",
      monsters: [slimeMonster.id, slimeMonster.id],
      rewards: {
        drops: [
          { itemId: waveTrophyItem.id, chance: 1, minQty: 2, maxQty: 2 },
        ],
      },
    },
  ],
};

// ---------- Locations ----------

export const forestLocation: LocationDef = {
  id: "location.forest.test" as LocationId,
  name: "Test Forest",
  entries: [
    { kind: "combat", combatZoneId: forestCombatZone.id, label: "Test Path" },
  ],
};

export const mineLocation: LocationDef = {
  id: "location.mine.test" as LocationId,
  name: "Test Mine",
  entries: [
    { kind: "gather", resourceNodes: [testVein.id], label: "Test Vein" },
  ],
};

// ---------- Loader ----------

export function loadFixtureContent(): ContentDb {
  const db: ContentDb = {
    ...emptyContentDb(),
    attributes: Object.fromEntries(
      Object.entries(attrDefs).map(([k, v]) => [k, v]),
    ),
    effects: {
      [basicStrikeEffect.id]: basicStrikeEffect,
      [burnDotEffect.id]: burnDotEffect,
      [shieldBuffEffect.id]: shieldBuffEffect,
      [phaseRecoveryEffect.id]: phaseRecoveryEffect,
      [outOfCombatRecoveryEffect.id]: outOfCombatRecoveryEffect,
      [combatSearchRecoveryEffect.id]: combatSearchRecoveryEffect,
      [dungeonWaveRestRecoveryEffect.id]: dungeonWaveRestRecoveryEffect,
    },
    talents: {
      [basicAttackTalent.id]: basicAttackTalent,
      [fireballTalent.id]: fireballTalent,
      [shieldSelfTalent.id]: shieldSelfTalent,
    },
    monsters: {
      [slimeMonster.id]: slimeMonster,
      [goblinMonster.id]: goblinMonster,
      [dropSlimeMonster.id]: dropSlimeMonster,
    },

    skills: {
      [miningSkill.id]: miningSkill,
    },
    items: {
      [testOreItem.id]: testOreItem,
      [waveTrophyItem.id]: waveTrophyItem,
      [killDropItem.id]: killDropItem,
    },

    resourceNodes: {
      [testVein.id]: testVein,
    },
    unlocks: {},
    locations: {
      [forestLocation.id]: forestLocation,
      [mineLocation.id]: mineLocation,
    },
    combatZones: {
      [forestCombatZone.id]: forestCombatZone,
      [dropCombatZone.id]: dropCombatZone,
    },

    dungeons: {
      [testDungeon.id]: testDungeon,
    },
  };
  setContent(db);
  registerBuiltinIntents();
  return db;
}

// ---------- Shared test harness ----------

export interface TestHarness {
  state: GameState;
  bus: GameEventBus;
  rng: Rng;
  currentTick: number;
}

export function makeHarness(seed = 42): TestHarness {
  loadFixtureContent();
  return {
    state: createEmptyState(seed, SAVE_VERSION),
    bus: createGameEventBus(),
    rng: createRng(seed),
    currentTick: 0,
  };
}

export function makeSlime(instanceId: string): Enemy {
  return createEnemy({
    instanceId,
    def: slimeMonster,
    side: "enemy",
  });
}

/** Build a PlayerCharacter for tests without going through the full skill/level path yet. */
export function makePlayer(overrides: {
  id: string;
  talents?: string[];
  hp?: number;
  mp?: number;
  /** 直接设置 PATK base（测试用，跳过 WEAPON_ATK + scaling 派生链路）。 */
  atk?: number;
  /** 直接设置 PDEF base。 */
  def?: number;
  speed?: number;
  maxHp?: number;
  maxMp?: number;
  inventoryStackLimit?: number;
  xpCurve?: FormulaRef;
}): PlayerCharacter {
  const base: Partial<Record<AttrId, number>> = {
    [ATTR.MAX_HP]: overrides.maxHp ?? 100,
    [ATTR.MAX_MP]: overrides.maxMp ?? 20,
    [ATTR.PATK]: overrides.atk ?? 10,
    [ATTR.PDEF]: overrides.def ?? 0,
    [ATTR.SPEED]: overrides.speed ?? 10,
    [ATTR.INVENTORY_STACK_LIMIT]: overrides.inventoryStackLimit ?? DEFAULT_CHAR_STACK_LIMIT,
  };
  const pc = createPlayerCharacter({
    id: overrides.id,
    name: overrides.id,
    xpCurve: overrides.xpCurve ?? testCharXpCurve,

    baseAttrs: base as Record<string, number>,
    knownTalents: (overrides.talents ?? []) as unknown as TalentId[],
  });
  if (overrides.hp !== undefined) pc.currentHp = overrides.hp;
  if (overrides.mp !== undefined) pc.currentMp = overrides.mp;
  return pc;
}

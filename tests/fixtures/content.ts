import { ATTR } from "../../src/core/attribute";
import { emptyContentDb, setContent, type ContentDb } from "../../src/core/content";
import type {
  AbilityDef,
  AbilityId,
  AttrDef,
  AttrId,
  EffectDef,
  EffectId,
  MonsterDef,
  MonsterId,
  SkillDef,
  SkillId,
  StageDef,
  StageId,
} from "../../src/core/content/types";
import { createGameEventBus } from "../../src/core/events";
import type { GameEventBus } from "../../src/core/events";
import { createRng, type Rng } from "../../src/core/rng";
import { createEmptyState, type GameState } from "../../src/core/state";
import {
  createEnemy,
  createPlayerCharacter,
  type Enemy,
  type PlayerCharacter,
} from "../../src/core/actor";
import type { FormulaRef } from "../../src/core/formula";
import { registerBuiltinIntents } from "../../src/core/intent";

// ---------- Shared attribute definitions ----------

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
  [ATTR.ATK]: {
    id: ATTR.ATK,
    name: "Atk",
    defaultBase: 10,
    integer: true,
    clampMin: 0,
  },
  [ATTR.DEF]: {
    id: ATTR.DEF,
    name: "Def",
    defaultBase: 0,
    integer: true,
    clampMin: 0,
  },
  [ATTR.SPEED]: {
    id: ATTR.SPEED,
    name: "Speed",
    defaultBase: 10,
    integer: true,
    clampMin: 1,
  },
};

// ---------- Common fixture effects ----------

export const basicStrikeEffect: EffectDef = {
  id: "effect.combat.strike" as EffectId,
  kind: "instant",
  magnitudeMode: "damage",
  formula: { kind: "atk_vs_def", atkMul: 1, defMul: 1 },
};

export const burnDotEffect: EffectDef = {
  id: "effect.combat.burn" as EffectId,
  kind: "periodic",
  durationTicks: 6,
  periodTicks: 2,
  magnitudeMode: "damage",
  formula: { kind: "constant", value: 3 },
};

export const shieldBuffEffect: EffectDef = {
  id: "effect.buff.shield" as EffectId,
  kind: "duration",
  durationTicks: 10,
  modifiers: [
    { stat: ATTR.DEF, op: "flat", value: 5, sourceId: "" },
  ],
};

// ---------- Common fixture abilities ----------

export const basicAttackAbility: AbilityDef = {
  id: "ability.basic.attack" as AbilityId,
  name: "Attack",
  targetKind: "single_enemy",
  effects: [basicStrikeEffect.id],
};

export const fireballAbility: AbilityDef = {
  id: "ability.fire.fireball" as AbilityId,
  name: "Fireball",
  cost: { mp: 5 },
  cooldownTicks: 20,
  targetKind: "single_enemy",
  effects: [basicStrikeEffect.id, burnDotEffect.id],
};

export const shieldSelfAbility: AbilityDef = {
  id: "ability.buff.shield_self" as AbilityId,
  name: "Shield",
  targetKind: "self",
  effects: [shieldBuffEffect.id],
};

// ---------- Common fixture monsters ----------

export const slimeMonster: MonsterDef = {
  id: "monster.slime" as MonsterId,
  name: "Slime",
  level: 1,
  baseAttrs: {
    [ATTR.MAX_HP]: 30,
    [ATTR.ATK]: 4,
    [ATTR.DEF]: 1,
    [ATTR.SPEED]: 5,
  },
  abilities: [basicAttackAbility.id],
  drops: [],
  xpReward: 10,
};

// ---------- Common fixture skills ----------

export const testXpCurve: FormulaRef = {
  kind: "exp_curve_v1",
  base: 10,
  growth: 1.2,
};

export const miningSkill: SkillDef = {
  id: "skill.mining" as SkillId,
  name: "Mining",
  xpCurve: testXpCurve,
  maxLevel: 99,
};

// ---------- Common fixture stages ----------

export const forestStage: StageDef = {
  id: "stage.forest.test" as StageId,
  name: "Test Forest",
  mode: "solo",
  monsters: [slimeMonster.id],
  waveSize: 1,
  waveIntervalTicks: 5,
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
    },
    abilities: {
      [basicAttackAbility.id]: basicAttackAbility,
      [fireballAbility.id]: fireballAbility,
      [shieldSelfAbility.id]: shieldSelfAbility,
    },
    monsters: {
      [slimeMonster.id]: slimeMonster,
    },
    skills: {
      [miningSkill.id]: miningSkill,
    },
    stages: {
      [forestStage.id]: forestStage,
    },
  };
  setContent(db);
  // Tests relying on Battle dispatching intents need the registry populated.
  registerBuiltinIntents();
  return db;
}

// ---------- Shared test harness ----------

export interface TestHarness {
  state: GameState;
  bus: GameEventBus;
  rng: Rng;
  attrDefs: Record<string, AttrDef>;
  currentTick: number;
}

export function makeHarness(seed = 42): TestHarness {
  loadFixtureContent();
  return {
    state: createEmptyState(seed, 1),
    bus: createGameEventBus(),
    rng: createRng(seed),
    attrDefs,
    currentTick: 0,
  };
}

export function makeSlime(instanceId: string): Enemy {
  return createEnemy({
    instanceId,
    def: slimeMonster,
    attrDefs,
    side: "enemy",
  });
}

/** Build a PlayerCharacter for tests without going through the full skill/level path yet. */
export function makePlayer(overrides: {
  id: string;
  abilities: string[];
  hp?: number;
  mp?: number;
  atk?: number;
  def?: number;
  speed?: number;
  maxHp?: number;
  maxMp?: number;
  xpCurve?: FormulaRef;
}): PlayerCharacter {
  const base: Partial<Record<AttrId, number>> = {
    [ATTR.MAX_HP]: overrides.maxHp ?? 100,
    [ATTR.MAX_MP]: overrides.maxMp ?? 20,
    [ATTR.ATK]: overrides.atk ?? 10,
    [ATTR.DEF]: overrides.def ?? 0,
    [ATTR.SPEED]: overrides.speed ?? 10,
  };
  const pc = createPlayerCharacter({
    id: overrides.id,
    name: overrides.id,
    xpCurve: overrides.xpCurve ?? testXpCurve,
    baseAttrs: base as Record<string, number>,
    knownAbilities: overrides.abilities as unknown as AbilityId[],
    attrDefs,
  });
  if (overrides.hp !== undefined) pc.currentHp = overrides.hp;
  if (overrides.mp !== undefined) pc.currentMp = overrides.mp;
  return pc;
}

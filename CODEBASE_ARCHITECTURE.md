# YAIA Codebase Architecture

## Overview

YAIA is a game engine built on TypeScript with a clear separation between:
- **Persisted State**: attrs.base, currentHp/Mp, activeEffects, cooldowns, equipped, knownAbilities, talents
- **Derived State**: abilities, modifiers, dynamicProviders, depGraph, cache (rebuilt on load)

---

## 1. Ability & Effect Pipeline

### AbilityDef (Content Layer)

interface AbilityDef {
  id: AbilityId
  name: string
  cost?: { mp?: number }
  cooldownTicks?: number
  energyCost?: number
  targetKind: "self" | "single_enemy" | "single_ally" | "all_enemies" | "all_allies" | "none"
  effects: EffectId[]
  tags?: string[]
}

### tryUseAbility() - 8-Step Validation Pipeline

Location: src/core/behavior/ability/index.ts

The function validates in this exact order and returns early on first failure:

1. Unknown ability: ability not in registry
2. Not known: player hasn't learned it (knownAbilities)
3. On cooldown: currentTick < cooldowns[abilityId]
4. MP cost: actor.MP < cost
5. Caster alive: actor.HP <= 0
6. Target existence: no valid targets available
7. Target count: wrong number of targets
8. Target side: target on wrong side (ally vs enemy)

Success path applies all effects and sets cooldown.

### CastResult Type

type CastResult = 
  | { ok: true; magnitude: number }
  | { ok: false; reason: string }

Key Design Pattern: Returns error codes instead of throwing exceptions. User-level violations (not learned, on cooldown) are expected and codified.

---

## 2. Effect System (Three Kinds)

### EffectDef (Content Layer)

type EffectKind = "instant" | "duration" | "periodic"

interface EffectDef {
  id: EffectId
  name?: string
  kind: EffectKind
  durationTicks?: number
  periodTicks?: number
  modifiers?: Modifier[]
  rewards?: {
    items?: { itemId: ItemId; qty: number }[]
    xp?: { skillId: SkillId; amount: number }[]
    charXp?: number
    currencies?: Record<string, number>
  }
  formula?: FormulaRef
  magnitudeMode?: "damage" | "heal"
  tags?: string[]
}

### applyEffect() - Effect Application

Location: src/core/behavior/effect/index.ts

applyEffect(effect, source, target, ctx): number
  case "instant": 
    - applyInstantPulse() - compute formula, apply damage/heal, emit events
    - return magnitude
  
  case "duration":
    - installTimedEffect() - install modifiers with sourceId, set remainingTicks
    - return 0
  
  case "periodic":
    - installTimedEffect() - install modifiers with sourceId, set remainingTicks
    - return 0

### ActiveEffect Runtime Structure

interface ActiveEffect {
  effectId: EffectId
  sourceId: string
  remainingTicks: number
}

sourceId format: "effect:<effectId>:<sourceActorId>:<appliedAtTick>"

### tickActiveEffects() - Per-Action-Window Decay

CRITICAL: This runs ONCE per action window, NOT per engine tick. It:

1. Snapshots activeEffects array
2. For each active effect:
   - Decrements remainingTicks by 1
   - If periodic: fires pulse when (duration - remaining) mod periodTicks equals 0
3. Removes expired effects and their modifiers via removeModifiersBySource(ae.sourceId)

---

## 3. ATB Scheduler

Location: src/core/combat/battle/scheduler.ts

### Constants

DEFAULT_ATB_ACTION_THRESHOLD = 1000
DEFAULT_ATB_BASE_ENERGY_GAIN = 40
DEFAULT_ATB_BASE_SPEED = 40
DEFAULT_ATB_INITIAL_ENERGY_PER_SPEED = 12

### Energy Per Tick Formula

energyGain = (actor.SPD / baseSpeed) * baseEnergyGain
           = (actor.SPD / 40) * 40
           = actor.SPD (at default SPD of 40)

### Opening Initiative

initialEnergy = min(actor.SPD * 12, 999)

### Ready State

ready when: energy >= actionThreshold (1000)

---

## 4. Battle State Machine

Location: src/core/combat/battle/battle.ts

### Battle Lifecycle

"ongoing" -> "players_won" or "enemies_won" or "draw"

### tickBattle() - 7-Step Loop

1. checkFinished() - if battle ended, return
2. resolveParticipants() - get fresh actors from GameState
3. emitDeaths() - fire death events for deathsReported
4. checkTermination() - both sides have actors?
5. advanceScheduler() - gain energy, find ready actors
6. actionWindowLoop() - up to MAX_ACTIONS_PER_TICK_FACTOR (32) actions
7. checkOutcome() - determine battle result

Safety Limit: MAX_ACTIONS_PER_TICK_FACTOR = 32 (prevents runaway loops)

---

## 5. Intent System (AI Decisions)

Location: src/core/combat/intent/index.ts

### Intent Type

type Intent = (actor: Character, ctx: IntentContext) => IntentAction or null

interface IntentAction {
  abilityId: string
  targets: Character[]
}

### Pure Function Design

- No mutation allowed
- No async operations
- Receives fresh context each call
- Returns action or null (skip turn)

### Helper Functions

enemiesOf(actor, allActors) -> Character[]
alliesOf(actor, allActors) -> Character[]

---

## 6. Character Hierarchy & Derived State Rebuild

### Actor Hierarchy

Actor (id, name, kind)
  - Character (currentHp, currentMp, attrs, activeEffects, cooldowns, abilities, side)
    - PlayerCharacter (level, exp, skills, equipped, talents, knownAbilities, ...)
    - Enemy (defId)
  - ResourceNode (defId)

### Persisted vs Derived

Persisted (saved to disk):
- attrs.base
- currentHp, currentMp
- activeEffects
- cooldowns
- equipped (players)
- knownAbilities (players)
- talents (players)

Derived (NOT persisted, rebuilt on load):
- abilities
- attrs.modifiers
- attrs.dynamicProviders
- attrs.depGraph
- attrs.cache

### rebuildCharacterDerived() - 8-Step Pipeline

Location: src/core/entity/actor/factory.ts

Step 1: Wipe derived state
  - attrs.modifiers = []
  - attrs.dynamicProviders = []
  - attrs.depGraph = {}
  - invalidateAttrs(attrs)

Step 2: Load equipped-item modifiers (players only)
  - FOR each equipped gear:
    - sourceId = "equip:<slot>:<gear.instanceId>"
    - addModifiers(itemDef.modifiers + gear.rolledMods, sourceId)

Step 3: Load world upgrade modifiers (players only)
  - IF worldRecord provided:
    - addModifiers(computeWorldModifiers(worldRecord))

Step 4: Load active-effect modifiers
  - FOR each activeEffect:
    - addModifiers(effectDef.modifiers, ae.sourceId)

Step 5: Install physScaling/magScaling DynamicModifierProviders
  - Player: from HeroConfig.physScaling / magScaling
  - Enemy: from MonsterDef (default: STR to 1.0, INT to 1.0)

Step 6: Build runtime ability list
  - Player: abilities = knownAbilities.slice()
  - Enemy: abilities already set at creation

Step 7: Rebuild depGraph
  - rebuildDepGraph(attrs, attrDefs)

Step 8: Clamp HP/MP
  - maxHp = recomputeStat(MAX_HP)
  - IF currentHp > maxHp: currentHp = maxHp

Call Sites:
- After character creation
- After loading a save
- After equipping/unequipping gear
- After effect applied/removed
- After purchasing world upgrade

---

## 7. Attribute System & Reactive Computation

Location: src/core/entity/attribute/index.ts

### recomputeStat() - Modifier Formula

result = (base + SUM flat) * (1 + SUM pct_add) * PRODUCT(1 + pct_mult)
  where:
    flat = all modifiers with op: "flat"
    pct_add = all modifiers with op: "pct_add"
    pct_mult = all modifiers with op: "pct_mult"

Then:
  IF clampMin defined: result = max(result, clampMin)
  IF clampMax defined: result = min(result, clampMax)
  IF integer: result = floor(result)

### Lazy Invalidation Strategy

invalidateStat(attrId):
  IF attrId not in cache:
    return
  DELETE cache[attrId]
  FOR each dependent in depGraph[attrId]:
    invalidateStat(dependent)

### DynamicModifierProvider

interface DynamicModifierProvider {
  sourceId: string
  targetAttrs: AttrId[]
  dependsOn: AttrId[]
  compute: (get: (id: AttrId) => number) => Modifier[]
}

---

## 8. Talent System Architecture

Location: src/core/content/types.ts

### TalentDef (Content Layer)

interface TalentDef {
  id: TalentId
  name: string
  effects: EffectId[]
  prereqs?: TalentId[]
  cost: number
}

### PlayerCharacter Talent State

talents: string[]

### Integration Points

1. Unlock Process:
   - Player has enough TP
   - All prereqs satisfied
   - Add talentId to talents array
   - Call rebuildCharacterDerived()

2. Effect Installation:
   - TalentDef.effects are applied as instant effects
   - For passive modifiers, use duration effects with long durationTicks

3. Modifier Sourcing:
   - sourceId prefix: "talent:<talentId>"
   - Enables targeted removal

---

## 9. Key Patterns for Implementation

### Pattern 1: Modifier Sourcing via sourceId

All modifiers include sourceId for:
- Targeted removal
- Debugging
- Stacking logic

Naming conventions:
"effect:<effectId>:<sourceActorId>:<appliedAtTick>"
"equip:<slot>:<gear.instanceId>"
"world.<upgradeId>"
"talent:<talentId>"
"skill:<skillId>"

### Pattern 2: Lazy Invalidation

- Cache only recomputed when queried
- Modifying any modifier marks affected stats invalid
- Dependents recursively invalidated via depGraph

### Pattern 3: DynamicModifierProvider for Reactive Stats

Use when a stat scales off other attributes:

{
  sourceId: "skill:power_scaling",
  targetAttrs: [ATTR.SKILL_POWER],
  dependsOn: [ATTR.LEVEL],
  compute: (get) => [{
    stat: ATTR.SKILL_POWER,
    op: "flat",
    value: get(ATTR.LEVEL) * 10,
    sourceId
  }]
}

### Pattern 4: Persisted vs Rebuilt State

Save to disk:
- PlayerCharacter.talents
- PlayerCharacter.skills

Rebuild on load:
- Active effects from talents
- Modifiers from talents
- Ability list

### Pattern 5: Error Codes Over Exceptions

User-level validation:
CastResult.failure("not_learned")
CastResult.failure("insufficient_tp")
CastResult.failure("prereqs_not_met")

System errors:
throw new Error("Missing content definition")
throw new Error("Circular dependency detected")

---

## Summary

Core principles:

1. Persisted state is minimal - Only save what cannot be derived
2. Derived state is consistent - Single rebuild function ensures correctness
3. Modifiers are traceable - sourceId enables debugging and removal
4. Lazy evaluation scales - Only compute when queried
5. Effects compose cleanly - Generic system enables buffs/debuffs/rewards
6. Content is data - All definitions are JSON-safe
7. Validation fails gracefully - Error codes for expected failures

These patterns enable seamless integration of skills and talents systems.

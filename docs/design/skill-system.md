# 技能系统架构

> 依赖：[combat-formula.md](./combat-formula.md), [jobs.md](./jobs.md), [reactive-attrs.md](./reactive-attrs.md)  
> 被依赖：monsters, equipment  
> **状态**：架构设计稿

---

## 1. 设计目标

jobs.md 定义了 24 个技能的游戏设计。本文解决技术架构：

1. 主动/被动/持续三种天赋怎么统一表达？
2. 技能执行逻辑如何承载千差万别的效果？
3. Effect 作为持久化实例如何携带运行时状态和事件钩子？
4. 时间单位（CD、buff 持续）用 tick 还是回合数？
5. Intent 如何在挂机场景下"不蠢"？

核心原则：**定义层在 ContentDb 里，不进存档，可以持有函数。实例层（effect 实例、CD 计数等）进存档，必须 JSON-safe。**

---

## 2. 概念模型

两个核心定义 + 一个实例：

```
TalentDef    "角色能学什么"      ContentDb 查表，持有函数
EffectDef    "一种效果的模板"    ContentDb 查表，持有函数
EffectInstance "施加在角色身上的效果实例"  持久化，JSON-safe
```

没有独立的 Action 层。Talent 的 `execute` 函数就是 action——直接编排效果施加的控制流。如果多个 talent 共享执行逻辑，抽成工具函数即可，不需要框架级抽象。

### 2.1 为什么不拆三层（Talent / Action / Effect）

GAS 之所以需要独立的 GameplayAbility，是因为 UE 有动画同步、网络预测、异步 Task 等复杂性。我们的挂机游戏里，技能执行是同步的、无动画依赖的。把控制流直接写在 `TalentDef.execute` 里完全 hold 得住。如果将来复杂度增长，从函数里抽取逻辑是纯重构，不涉及数据结构变更。

### 2.2 为什么钩子在 Effect 上而非 Talent 上

关键场景：牧师给队友上"反击护盾"buff——队友被打时触发反击，反击伤害按牧师面板算。

- 钩子不能挂在队友的 talent 上——队友可能是战士，没学这个技能
- 钩子必须跟着**被施加的 effect 实例**走
- effect 实例上的 `state` 可以快照牧师面板，供钩子使用

所以：**事件钩子挂在 EffectDef 上，跟着 effect 实例的生命周期存在和消亡。**

### 2.3 人怪同模

怪物也使用 TalentDef 定义行为。TalentDef 上 `maxLevel`、`tpCost`、`prereqs` 等面向玩家成长的字段对怪物无意义，但可以省略（可选字段）。好处是整条执行管线（tryUseTalent、dispatchReaction 等）不需要按人/怪分岔。

怪物的被动 effect 通过 `MonsterDef.passiveEffects: EffectId[]` 声明，在 `createEnemy` 时安装（和玩家学会被动天赋时调用 `grantEffects` 安装 infinite effect 同理）。

### 2.4 ContentDb 与函数

ContentDb 原有的约定是"纯数据"。技能系统引入后，`TalentDef` 和 `EffectDef` 携带函数（`execute`、`reactions`、`computeBase` 等），不再是纯数据。

**源码目录分离**：将纯数据定义和携带行为的定义在文件组织上分开，降低心智负担。

```
content/
  data/             # 纯数据（items, monsters, locations, recipes, ...）
  behaviors/        # 携带函数的定义（talents, effects）
    talents/
      knight.ts
      ranger.ts
      mage.ts
      priestess.ts
    effects/
      combat.ts     # 通用战斗 effects
      knight.ts     # 骑士专属 effects
      ...
```

ContentDb 在运行时仍然是一个统一的注册表。分离只在源码组织层面。

---

## 3. TalentDef

```ts
interface TalentDef {
  id: TalentId;
  name: string;
  type: "active" | "passive" | "sustain";
  maxLevel: number;
  tpCost: number;                 // 每级 TP 消耗
  prereqs?: { talentId: TalentId; minLevel: number }[];
  tags?: string[];

  // ---- active 技能 ----

  /** 返回该等级下的使用参数。省略 = 非主动技能。 */
  getActiveParams?: (level: number) => {
    mpCost: number;
    cooldownActions: number;      // CD，单位：自身行动次数
    energyCost: number;           // ATB 能量消耗
    targetKind: TargetKind;
  };

  /**
   * 主动技能执行逻辑。通用管线完成校验+扣资源后调用。
   * 这就是 action——内部自由编排：多段、分配、条件分支、施加 effect。
   */
  execute?: (level: number, caster: Character, targets: Character[], ctx: CastContext) => void;

  /**
   * 声明式快捷路径。如果没有 execute，通用管线按顺序对每个目标
   * apply 这些 effect（和旧 AbilityDef.effects 语义相同）。
   * 用于简单技能和怪物默认攻击，避免为每个平 A 都写 execute 函数。
   * 如果同时提供了 execute 和 effects，execute 优先。
   */
  effects?: EffectId[];

  // ---- passive / sustain ----

  /**
   * 学会后（passive）或开启后（sustain）施加给自身的效果。
   * 返回要安装的 effect 描述（effectId + 初始 state）。
   */
  grantEffects?: (level: number, owner: Character) => EffectApplication[];

  // ---- sustain 专属 ----

  /** 开启消耗。 */
  activationCost?: { mp?: number };
  /** 互斥组。同组只能激活一个 sustain。作用域是单个角色，不跨角色。 */
  exclusiveGroup?: string;
}
```

### 三种类型的执行路径

| 类型 | 学习时 | 使用时 |
|------|--------|--------|
| active | 加入 knownTalents | Intent 选中 → 通用管线校验 → `execute()` 或 fallback `effects[]` |
| passive | `grantEffects()` → 安装 infinite effect（带 reaction） | 自动生效，无需操作 |
| sustain | 记录可用姿态 | **战斗创建后、首次 tick 前**根据玩家配置直接安装，不消耗行动 |

#### Sustain 安装时机

Sustain 不通过 intent / 行动窗口激活。在 `createBattle` 之后、第一次 `tickBattle` 之前，扫描所有玩家的 sustain 配置，调用 `grantEffects()` 安装 infinite effect。这避免了浪费行动次数和"刚装的 buff 被首次 tickEffects 消耗一回合"的问题。

#### 被动 / Sustain 升级时的 effect 刷新

天赋升级时，需要拆卸旧等级安装的 infinite effect，用新等级重新安装。

识别方式：`EffectInstance.sourceTalentId` 记录由哪个天赋安装。升级时按 `sourceTalentId` 定位所有相关 effect → 执行 `onRemove` → 撤销 modifiers → 移除实例 → 用新等级调用 `grantEffects()` 重新安装。

### execute 示例

**重击**（简单单体）：
```ts
execute: (level, caster, targets, ctx) => {
  const coeff = 1.3 + level * 0.04;
  ctx.dealPhysicalDamage(caster, targets[0], coeff);
},
```

**连射**（多段同一目标）：
```ts
execute: (level, caster, targets, ctx) => {
  const coeff = 0.55 + level * 0.02;
  for (let i = 0; i < 2; i++) {
    ctx.dealPhysicalDamage(caster, targets[0], coeff);
  }
},
```

**魔法飞弹**（自适应分配）：
```ts
execute: (level, caster, targets, ctx) => {
  const missileCount = 2 + Math.floor(level / 3);
  const coeff = 0.6;
  const enemies = ctx.aliveEnemies();
  for (let i = 0; i < missileCount; i++) {
    const target = enemies[i % enemies.length];
    ctx.dealMagicDamage(caster, target, coeff);
  }
},
```

**战吼**（多目标 + 自身 buff）：
```ts
execute: (level, caster, targets, ctx) => {
  // 对所有敌人施加嘲讽
  for (const enemy of targets) {
    ctx.applyEffect("effect.taunt", caster, enemy, {
      tauntTargetId: caster.id,
      durationActions: 2 + Math.floor(level / 3),
    });
  }
  // 自身减伤 buff
  ctx.applyEffect("effect.warcry_armor", caster, caster, {
    damageReduction: 0.1 + level * 0.02,
    durationActions: 3,
  });
},
```

**反击**（被动，通过 effect reaction 实现）：
```ts
type: "passive",
grantEffects: (level, owner) => [{
  effectId: "effect.retaliation",
  state: { chance: 0.15 + level * 0.03 },
}],
```

**怪物默认物理攻击**：直接复用通用 `talent.basic.attack`；只有怪物专用的魔法普攻才保留独立天赋定义。


---

## 4. EffectDef

EffectDef 是效果的**模板**。它在 ContentDb 中，持有函数，不序列化。

```ts
interface EffectDef {
  id: EffectId;
  name?: string;
  durationType: "instant" | "duration" | "periodic" | "infinite";
  tags?: string[];

  /** 声明式快捷字段（简单 effect 不需要写函数）。 */
  modifiers?: Modifier[] | ((state: EffectState) => Modifier[]);
  formula?: FormulaRef;
  magnitudeMode?: "damage" | "heal";
  stackMode?: "separate" | "refresh" | "stackable";
  maxStacks?: number;

  /** reaction dispatch 优先级。数字越小越先执行。默认 0。 */
  reactionPriority?: number;

  // ---- 生命周期钩子 ----

  /** 施加时调用。可以快照数据到 state、安装 modifier 等。 */
  onApply?: (source: Character, target: Character, state: EffectState, ctx: EffectContext) => void;

  /** periodic 效果的每回合 tick。 */
  onTick?: (owner: Character, state: EffectState, ctx: EffectContext) => void;

  /** 移除时调用。 */
  onRemove?: (owner: Character, state: EffectState, ctx: EffectContext) => void;

  // ---- 战斗反应钩子 ----

  /**
   * 按事件类型分发的战斗反应 map。
   * key = ReactionEvent["kind"]，TypeScript 自动收窄 event 参数类型。
   * effect 存续期间生效，移除后自动取消。
   *
   * 命名约定：战斗结算内的同步可变钩子统一叫 "reaction"，
   * 与 GameEventBus 的只读事后通知做硬区分。
   */
  reactions?: ReactionHooks;
}
```

### 4.1 ReactionEvent 与 ReactionHooks

伤害相关的事件不按物理/魔法拆分成不同 kind，而是在 payload 里带 `damageType: DamageType` 参数。reaction 回调内部按需判断（如反伤只针对物理攻击时，检查 `event.damageType === "physical"`）。不同 event kind 有不同的参数集，各自携带该事件语境下需要的信息。

```ts
/**
 * 战斗反应事件。discriminated union，按需扩展新 variant。
 *
 * 命名叫 ReactionEvent 而非 BattleEvent，与 GameEventBus 的
 * GameEvents 做命名级硬区分。两者职责不同，不可混用。
 *
 * 每个 variant 标注了 dispatch 模式：
 *   targeted  - 只 dispatch 给事件主体身上的 effects
 *   broadcast - dispatch 给全体同侧存活角色身上的 effects
 */
type DamageType = "physical" | "magical";

type ReactionEvent =
  // ---- targeted ----
  | { kind: "before_damage_taken"; attacker: Character; rawDamage: number;
      damageType: DamageType; result: { finalDamage: number } }
                                                               // → target
  | { kind: "after_damage_taken"; attacker: Character; damage: number;
      damageType: DamageType }                                 // → target
  | { kind: "after_damage_dealt"; target: Character; damage: number;
      damageType: DamageType; abilityId?: string }             // → caster
  | { kind: "on_kill"; victim: Character }                     // → caster
  | { kind: "on_heal_dealt"; target: Character; amount: number }
                                                               // → caster
  | { kind: "on_action_resolved"; abilityId: string; targets: Character[] }
                                                               // → caster
  // ---- broadcast (全体同侧存活角色) ----
  | { kind: "on_ally_damaged"; ally: Character; attacker: Character;
      damage: number }                                         // → allies
  | { kind: "battle_start" }                                   // → all
  | { kind: "battle_end" }                                     // → all
  | { kind: "wave_end" }                                       // → all
  ;

/**
 * 战斗反应钩子 map。每个 key 对应一个事件类型，value 是该事件的处理函数。
 */
type ReactionHooks = {
  [K in ReactionEvent["kind"]]?: (
    owner: Character,
    event: Extract<ReactionEvent, { kind: K }>,
    state: EffectState,
    ctx: ReactionContext,
  ) => void;
};
```

**类型安全**：TypeScript 的 `Extract` 自动把 `event` 参数收窄到对应类型。写 reaction 时有完整类型提示，不需要手动断言。

**多事件监听**：一个 effect 可以同时提供多个 reaction key。引擎 dispatch 时检查 `effectDef.reactions?.[event.kind]` 是否存在（O(1)），不需要额外的 subscribes 列表。

**扩展事件**：在 `ReactionEvent` 联合体加新 variant + 在战斗管线对应位置 emit。所有现有 effect 不受影响——它们的 reactions 里没有新 key，自然不会被调用。

---

## 5. EffectInstance（持久化）

施加在角色身上的 effect 实例。必须 JSON-safe。

```ts
interface EffectInstance {
  effectId: EffectId;
  sourceActorId: string;       // 施法者 ID
  sourceId: string;            // modifier 撤销用的唯一 key
  sourceTalentId?: TalentId;   // 由哪个天赋安装的（被动/sustain）
  remainingActions: number;    // 剩余回合数，-1 = infinite
  stacks: number;              // 仅 stackable 模式有意义
  /** 实例数据。JSON-safe。effect 定义的函数读写它。 */
  state: Record<string, unknown>;
}
```

### 为什么需要 state

effect 不是纯定义引用。施加时需要**实例化数据**：

| 场景 | state 内容 |
|------|-----------|
| DoT（伤害和施法者面板相关） | `{ snapshotAtk: 150, tickDamage: 45 }` |
| 嘲讽 | `{ tauntTargetId: "player.knight" }` |
| 反击护盾（牧师施加，按牧师面板反击） | `{ shieldHp: 200, casterMatk: 120, counterCoeff: 0.3 }` |
| 减速 | `{ spdReduction: 0.2 }` |
| 反击被动（概率随等级变化） | `{ chance: 0.25 }` |

state 是 `Record<string, unknown>`。每个 EffectDef 的函数知道自己 state 的 shape。在定义文件内部可以声明局部类型接口获得类型提示：

### 技能等级与 EffectDef 参数的关系

Talent 在 `execute` / `grantEffects` 时根据当前等级计算好所有数值，通过 state 传入 effect。**Effect 不需要知道 talent 的存在，也不读取技能等级。** 这保证了 effect 定义的通用性——同一个 EffectDef 可以被不同等级的 talent、不同来源（怪物技能、装备触发）复用，只要传入的 state 符合预期 shape。

```ts
// 在 effect 定义文件内部
interface RetributionShieldState {
  shieldHp: number;
  maxShieldHp: number;
  casterMatk: number;
  counterCoeff: number;
}

const retributionShield: EffectDef = {
  id: "effect.retribution_shield" as EffectId,
  durationType: "duration",
  reactions: {
    before_damage_taken: (owner, event, state, ctx) => {
      const s = state as unknown as RetributionShieldState;
      const absorbed = Math.min(s.shieldHp, event.rawDamage);
      event.result.finalDamage -= absorbed;
      s.shieldHp -= absorbed;
      // 反击，用牧师快照面板
      ctx.dealDamage(event.attacker, Math.floor(s.casterMatk * s.counterCoeff));
      if (s.shieldHp <= 0) ctx.removeEffect(owner, state);
    },
    on_kill: (owner, event, state, ctx) => {
      const s = state as unknown as RetributionShieldState;
      s.shieldHp = Math.min(s.maxShieldHp, s.shieldHp + 50);
    },
  },
};
```

---

## 6. 时间单位：回合数（action count）

### 6.1 统一改为回合数

ATB 系统下，角色行动频率差异大（SPD 高的角色单位时间内行动更多）。用 tick 表达 CD / buff 持续时间有两个问题：

- 相同 tick CD 对快角色"更短"（因为 tick 在流逝而不管行动了几次）
- 设计者难以直觉理解"30 tick CD"对不同 SPD 角色意味着什么

改为**回合数**（自身行动次数）语义更清晰：

| 概念 | 旧（tick） | 新（action count） |
|------|-----------|-------------------|
| 技能 CD | `cooldownTicks: 20` | `cooldownActions: 3` |
| buff 持续 | `durationTicks: 10` | `durationActions: 3` |
| periodic 频率 | `periodTicks: 2` | `periodActions: 1`（每回合一次） |

### 6.2 Periodic effect 也用回合数

DoT / HoT 按**目标自身的行动次数**触发，与经典 FF ATB（FFV–VII、FFX-2）一致。

这意味着 DoT 对高 SPD 目标实际 DPS 更高（行动更频繁 → 触发更多次），对慢速目标 DPS 更低。这是有意的设计——DoT 天然克制高 SPD 目标。配合 jobs.md 的设计："毒箭 DoT 用固定伤害补救高甲"之外，还多了一层战术维度。

Core 内部因此存在两种时间轴：

| 时间轴 | 用途 |
|--------|------|
| engine tick（10 Hz） | ATB 充能、采集摆动、波次搜索间隔、UI 动画 |
| action count（自身行动次数） | 技能 CD、buff 持续、periodic 频率、effect 生命周期 |

两者共存，不冲突。架构约定更新为：**engine tick 驱动模拟推进，action count 驱动技能/效果时间线。**

### 6.3 SPD 的角色

改用回合数后，SPD **只影响 ATB 充能速度**（多久轮到你行动一次）。CD 和 buff 持续时间与 SPD 解耦。

这意味着：
- 快角色的优势是**单位时间内行动更多次**（DPS 高）
- 但 CD 不会因为快就更短，buff 不会因为快就更快过期
- 设计更可控：一个"3 回合 CD"对所有 SPD 的角色都是"打 3 下才能再用"
- SPD debuff（如寒霜射线减速）不影响 buff/debuff 的持续回合数——减速只让目标行动变慢，不延长或缩短 buff 时长。这是期望的行为。

### 6.4 沉静射击 = CD 为 N 回合的技能

不需要特殊的 `nth_attack` 机制。沉静射击就是一个主动技能，`cooldownActions: 4`（随等级递减）。CD 好了 → Intent 自动在下一次行动时选择它代替普攻。

### 6.5 实现

CD 存储在 Character 上：

```ts
// Character 上（持久化）
cooldowns: Record<string, number>;  // talentId → 剩余行动次数
```

每次该角色行动结束时，全部 CD 减 1：

```ts
for (const id of Object.keys(c.cooldowns)) {
  if (c.cooldowns[id] > 0) c.cooldowns[id]--;
}
```

buff 持续时间同理：`EffectInstance.remainingActions` 在 owner 行动时减 1。

---

## 7. Reaction dispatch 管线

### 7.1 战斗管线中的 reaction 插入点

```
runActorActionWindow(battle, actor, participants, ctx):
  1. tickEffects(actor)         // 推进 periodic、减少 remaining
  2. if !isAlive(actor): return
  3. intent → plan
  4. tryUseTalent(plan):
     4a. 通用校验（alive、known、CD、MP、target）
     4b. 扣资源、设 CD
     4c. talent.execute(level, caster, targets, ctx)
         → 内部调用 ctx.dealDamage / ctx.applyEffect 等
         → dealDamage 内部：
           ① dispatchReaction(target, { kind: "before_damage_taken", ... })
           ② 扣 HP
           ③ dispatchReaction(target, { kind: "after_damage_taken", ... })
           ④ dispatchReaction(caster, { kind: "after_damage_dealt", ... })
           ⑤ if killed: dispatchReaction(caster, { kind: "on_kill", ... })
     4d. dispatchReaction(caster, { kind: "on_action_resolved", ... })
  5. 减 CD（所有 CD 计数 -1）
  6. 检测死亡 / 终局
```

### 7.2 dispatchReaction 实现

```ts
function dispatchReaction(
  actor: Character,
  event: ReactionEvent,
  ctx: ReactionContext,
): void {
  // 收集所有有 handler 的 effect，按 reactionPriority 排序
  const entries: { inst: EffectInstance; handler: ReactionHandler }[] = [];
  for (const inst of actor.activeEffects) {
    const def = getEffect(inst.effectId);
    const handler = def.reactions?.[event.kind];
    if (handler) {
      entries.push({ inst, handler });
    }
  }
  entries.sort((a, b) =>
    (getEffect(a.inst.effectId).reactionPriority ?? 0) -
    (getEffect(b.inst.effectId).reactionPriority ?? 0)
  );

  for (const { inst, handler } of entries) {
    // 重入防护：同一 effectId + 同一 event kind 不可自我重入
    const reentryKey = `${inst.effectId}:${event.kind}`;
    if (ctx.activeReactionKeys.has(reentryKey)) continue;

    ctx.activeReactionKeys.add(reentryKey);
    handler(actor, event as any, inst.state, ctx);
    ctx.activeReactionKeys.delete(reentryKey);
  }
}
```

**重入防护**：用 `effectId:eventKind` 作为 key。效果：
- 反击 → 造伤 → 对方反击 hook → 造伤 → 回到己方反击 hook → **跳过**（同 effectId + 同 kind）。
- 反击 → 击杀 → 同 effect 的 on_kill reaction → **正常触发**（同 effectId + 不同 kind）。

作为安全网，保留 `MAX_REACTION_DEPTH = 8`，超过时 alpha 阶段直接 throw，用于捕捉设计者没想到的循环。

**优先级**：`reactionPriority` 越小越先执行。典型用法：减伤类 reaction 设 priority -10（先算减伤），护盾吸收设 priority 0（后算吸收）。默认 0。

### 7.3 broadcast 事件

`on_ally_damaged`、`battle_start`、`battle_end`、`wave_end` 是 broadcast 类型——需要 dispatch 给多个角色。

```ts
function dispatchBroadcastReaction(
  actors: Character[],
  event: ReactionEvent,
  ctx: ReactionContext,
): void {
  for (const actor of actors) {
    dispatchReaction(actor, event, ctx);
  }
}
```

调用侧根据事件类型决定 dispatch 范围：
- `on_ally_damaged`：dispatch 给 target 的全体同侧存活角色（不含 target 自身）
- `battle_start` / `battle_end` / `wave_end`：dispatch 给全体存活角色

### 7.4 与 GameEventBus 的关系

两套系统共存，命名和职责做硬区分：

| | GameEventBus (`bus.emit`) | Reaction (`dispatchReaction`) |
|---|---|---|
| **定位** | 松耦合跨系统只读通知 | 战斗结算内同步可变钩子 |
| **类型名** | `GameEvents` | `ReactionEvent` / `ReactionHooks` |
| **同步性** | 同步但无顺序保证 | 同步、按 reactionPriority 排序执行 |
| **可修改事件** | 否 | 是（`before_damage_taken` 可改 `finalDamage`） |
| **生命周期** | 全局订阅/取消 | 跟随 effect 实例自动生灭 |
| **用途** | UI 更新、成就、日志、存档调度 | 被动技能、buff 联动、反击、吸血 |

**判断规则：这个响应需要在 `return` 之前修改战斗数据吗？是 → reaction。否 → bus。**

---

## 8. Intent

### 8.1 设计原则

挂机游戏的 AI 不需要"聪明"，但需要"不蠢"：满血不奶、CD 好了用技能、姿态开场施放。

### 8.2 PriorityListIntent

替代现有 `RandomAttackIntent`，用优先级表：

```ts
interface PriorityRule {
  talentId: TalentId;
  targetPolicy: TargetPolicy;
  conditions?: UseCondition[];
}

type TargetPolicy =
  | "self"
  | "random_enemy"
  | "lowest_hp_enemy"
  | "lowest_hp_ally"       // 治疗
  | "highest_atk_ally"     // 神恩
  | "all_enemies";

type UseCondition =
  | { kind: "off_cooldown" }
  | { kind: "has_mp"; min: number }
  | { kind: "target_hp_below"; threshold: number }
  | { kind: "no_effect_on_target"; effectId: EffectId }
  | { kind: "battle_first_action" }
  | { kind: "sustain_not_active"; group: string };
```

解析流程：按顺序遍历规则 → 找到第一个条件全满足且有合法目标的 → 返回。全部失败 → 默认攻击。

Intent 是纯函数（不做状态变更）。`tryUseTalent` 可能因为实际 CD / MP 不足而失败——这没关系。

### 8.3 玩家配置

玩家通过 UI 配置技能优先级顺序（拖拽排序）、姿态选择、简单条件开关。配置存储在 `PlayerCharacter` 上。

---

## 9. 技能映射示例

### 骑士

| 技能 | 类型 | 实现方式 |
|------|------|---------|
| **重击** | active | `execute`: 单体物理伤害，系数 130%~200% |
| **战吼** | active | `execute`: 对所有敌人施加嘲讽 effect + 自身减伤 effect |
| **坚守** | passive | `grantEffects`: 安装 infinite effect，modifiers: [+HP%, +PDEF%] |
| **反击** | passive | `grantEffects`: 安装 infinite effect，reactions.after_damage_taken: 概率反击 |
| **狂怒** | sustain | `grantEffects`: 安装 infinite effect，modifiers: [+PATK%, -PDEF%]。exclusiveGroup: "knight.stance" |
| **守护** | sustain | `grantEffects`: 安装 infinite effect，modifiers: [+PDEF%, -PATK%]，reactions.on_ally_damaged: 概率代受 |

### 圣女

| 技能 | 类型 | 实现方式 |
|------|------|---------|
| **神圣打击** | active | `execute`: 单体魔法伤害 |
| **治疗** | active | `execute`: 单体治疗（targetKind: single_ally） |
| **守护祈祷** | passive | `grantEffects`: infinite effect，modifiers: [+HP%]，reactions.wave_end: 额外回复 |
| **圣愈打击** | passive | `grantEffects`: infinite effect，reactions.after_damage_dealt + tag 过滤: 回复自身 HP/MP |
| **神圣愤怒** | passive | `grantEffects`: infinite effect，modifiers: [针对 smite 的 +CRIT_RATE, +CRIT_MULT] |
| **神恩** | active | `execute`: 给目标施加 duration effect（+PATK% 或 +MATK% 按目标职业） |

### 怪物

| 怪物 | 实现方式 |
|------|---------|
| **毒蘑菇** | talent 的 execute 里：普攻伤害 + `ctx.applyEffect("effect.poison_dot", ...)` |
| **矿石蟹** | TalentDef 带 passive grantEffects，安装 infinite effect，reactions.after_damage_taken: 反弹伤害 |
| **巨狼** | talent: 嚎叫（CD 好了对所有队友施加 +ATK% duration effect）。Intent 优先嚎叫 |

---

## 10. 叠加规则

```ts
// EffectDef 上
stackMode?: "separate" | "refresh" | "stackable";
maxStacks?: number;
```

| 模式 | 行为 | `stacks` 字段 | 用途 |
|------|------|--------------|------|
| `separate`（默认） | 每次独立安装，各自倒计时 | 恒为 1，无意义 | DoT（多层毒各自独立） |
| `refresh` | 重复安装时刷新持续时间 | 恒为 1 | 标记、减速 debuff |
| `stackable` | 叠加到 maxStacks 后不再增加新层 | 1~maxStacks | 巨狼激励 buff |

---

## 11. 属性刷新

技能系统引入了两类属性依赖场景：

- **派生 base**：PATK = f(STR, WEAPON_ATK)，STR 变了 PATK 要更新。
- **动态 modifier**：被动"基于 INT 提升治疗量"，INT 因 buff 变化后 modifier value 要跟着变。

这些由属性系统内部的**响应式 lazy invalidation** 机制统一解决。详见 **[reactive-attrs.md](./reactive-attrs.md)**。

技能系统作为消费侧，只需要：
- 在 `grantEffects` 安装 effect 时，用 `DynamicModifierProvider` 注册动态 modifier。
- 在天赋升级时，卸载旧 provider + 安装新 provider。
- 不需要手动触发刷新——属性系统的 invalidation 传播自动处理。

---

## 12. 对现有代码的影响

### 需要替换/重写

| 改动 | 说明 |
|------|------|
| `AbilityDef` → `TalentDef` | **完全替换**。新 TalentDef 增加 `type`、`execute`、`grantEffects` 等函数字段，删除旧 `effects`/`cost` 结构。旧 TalentDef 和旧 AbilityDef 的所有消费者需要重写。 |
| `EffectDef` 增加 `reactions`、`onApply/onTick/onRemove` | 从纯数据升级为可持有函数。`hooks` → `reactions` 命名变更。 |
| `ActiveEffect` → `EffectInstance` | 增加 `state`、`sourceActorId`、`sourceTalentId`。`remainingTicks` → `remainingActions`。 |
| `cooldowns` 语义 | 从 tick 改为 action count |
| `tryUseAbility` → `tryUseTalent` | 校验逻辑基本不变。执行部分改为调用 `talent.execute()` 或 fallback `talent.effects[]`。 |
| `tickActiveEffects` | 语义从 tick 变为 action |
| 战斗管线 | 在 damage 结算处插入 `dispatchReaction` 调用 |
| `PriorityListIntent` | 新增，替代 `RandomAttackIntent` |
| `BattleEvent` | 重命名为 `ReactionEvent`，dispatch 函数重命名为 `dispatchReaction` |

### 新增

| 模块 | 说明 |
|------|------|
| `DynamicModifierProvider` | 属性系统新增，详见 [reactive-attrs.md](./reactive-attrs.md) |
| `AttrDef.computeBase` / `dependsOn` | 属性系统新增，详见 [reactive-attrs.md](./reactive-attrs.md) |
| Sustain 安装管线 | createBattle 后、首次 tick 前安装 sustain effect |
| `content/behaviors/` 目录 | 携带函数的 TalentDef / EffectDef 定义文件 |

### 可保留

| 模块 | 说明 |
|------|------|
| ATB Scheduler | 不变，SPD 只影响充能速率 |
| Battle 结构 | 不变，仍然是纯数据 |
| CombatActivity 状态机 | 不变 |
| Attribute / Modifier 基础系统 | 堆叠模型不变，扩展 invalidation 传播 |
| ContentDb / Registry | 结构不变，内容类型变了 |
| GameEventBus | 不变，保持只读通知职责 |

---

## 开放问题

- [ ] `CastContext` / `ReactionContext` 的工具函数集（`dealPhysicalDamage`、`dealMagicDamage`、`applyEffect`、`aliveEnemies` 等）的具体 API 设计
- [ ] Intent 条件扩展：`self_hp_below`、`ally_count_below` 等条件将来按需加入

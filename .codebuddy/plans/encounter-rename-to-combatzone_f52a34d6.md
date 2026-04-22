---
name: encounter-rename-to-combatzone
overview: 将项目中所有 `Encounter` 概念重命名为 `CombatZone`，涉及类型、注册表、内容ID、变量名、文档等约 136 处机械替换，跨 18 个文件。
todos:
  - id: rename-core-types
    content: 重命名核心类型源头：修改 src/core/content/types.ts 中 EncounterId/EncounterDef/EncounterWaveSelection 及 ContentDb/emptyContentDb/LocationEntryDef 中所有 encounter 引用为 CombatZone 对应名
    status: completed
  - id: rename-registry
    content: 修改 src/core/content/registry.ts：encounters→combatZones, getEncounter→getCombatZone, 错误消息更新
    status: completed
    dependencies:
      - rename-core-types
  - id: rename-stage
    content: 修改 Stage 层：src/core/stage/types.ts 中 encounterId→combatZoneId；src/core/stage/controller.ts 中 import、接口字段、函数参数、局部变量、pickEncounterWave→pickCombatZoneWave、错误消息和顶部设计注释
    status: completed
    dependencies:
      - rename-registry
  - id: rename-activity-session-events
    content: 修改 Activity/Session/Events 层：src/core/activity/combat.ts、src/core/session/index.ts、src/core/events/index.ts 中所有 encounter 引用改为 combatZone
    status: completed
    dependencies:
      - rename-stage
  - id: rename-content-ui
    content: 修改内容定义和 UI：src/content/index.ts 中类型/变量/id 字符串/注册表键；src/ui/App.tsx 中 entry.encounterId→entry.combatZoneId
    status: completed
    dependencies:
      - rename-activity-session-events
  - id: rename-tests
    content: 修改全部测试文件：tests/fixtures/content.ts 的 forestEncounter→forestCombatZone 及注册表键；tests/core/ 下 activity/catch-up-integration/session/pending-loot 测试中的 import 和使用
    status: completed
    dependencies:
      - rename-content-ui
  - id: rename-docs-verify
    content: 更新 docs/modules/stage-activity.md、session.md、combat.md 和 docs/roadmap.md 中所有 encounter 引用；使用 [subagent:code-explorer] 执行 rg 扫描验证无残留；运行 typecheck 和测试确认通过
    status: completed
    dependencies:
      - rename-tests
---

## 用户需求

将项目中的 `Encounter` 概念全局重命名为 `CombatZone`，涵盖类型、变量、函数、内容 ID、注释和文档。

## 产品概述

这是一次纯语义层的概念重命名重构。当前 `EncounterDef` 的实际语义是"一个可反复刷怪的战斗区域"（从 waves 中随机抽选、无限循环），而非传统 RPG 中的"单次遭遇"。为后续 Dungeon（副本）系统的引入提供清晰的命名空间：CombatZone = 随机循环刷怪区域，Dungeon = 固定顺序波次序列，两者并列存在。

## 核心内容

- 所有 `Encounter*` 类型/接口重命名为 `CombatZone*`
- 所有 `encounterId` 字段/变量/参数改为 `combatZoneId`
- `ContentDb.encounters` 注册表键改为 `combatZones`
- `getEncounter()` 函数改为 `getCombatZone()`
- 内容 ID 从 `encounter.forest.*` 改为 `zone.forest.*`
- 测试 fixture 变量 `forestEncounter` 改为 `forestCombatZone`
- 所有相关注释和文档同步更新
- typecheck 和全部测试通过
- 无残留的 `encounter` 引用（docs 中概念解释除外）

## 技术栈

- 语言：TypeScript
- 运行时：Bun
- 框架：React + Vite
- 测试：bun test

## 实施方案

**策略**：从类型源头出发，逐层向外扩展的机械替换。先改核心类型定义（`content/types.ts`），让 TypeScript 编译器暴露所有下游依赖，再按依赖顺序逐批修改消费方。

**关键决策**：

1. 按「类型源头 → 注册表 → Stage 层 → Activity 层 → Session 层 → 内容定义 → UI → 测试 → 文档」的依赖顺序分批执行，确保每批改完后 TypeScript 可以定位下一批的错误
2. 内容 ID 的命名空间从 `encounter.` 改为 `zone.`（如 `zone.forest.slime_normal`），保持 dot-namespaced 风格
3. Alpha 阶段不需要存档迁移，旧存档直接失效
4. 内部函数 `pickEncounterWave` → `pickCombatZoneWave`，`lookupWave` 的参数名 `encounter` → `zone`

## 实施注意事项

- **注释保留**：AGENTS.md 要求不能随意删除注释。所有含 encounter 的注释需更新为 combat zone，而非删除
- **文件头设计笔记**：`controller.ts` 和 `combat.ts` 的顶部设计注释是 load-bearing 的，必须更新其中的 encounter 引用
- **错误消息字符串**：`content: no encounter` → `content: no combatZone`，`stage: encounter "..." has no waves` → `stage: combatZone "..." has no waves` 等
- **事件类型**：`waveResolved` 事件的 `encounterId` 字段改为 `combatZoneId`，需要检查所有事件消费方（`combat.ts` 中的 emit 调用）
- **验证**：最后用 `rg -i encounter src/ tests/` 扫描残留

## 架构设计

改名不改变任何架构关系。现有依赖链不变：

```
ContentDb.combatZones (原 encounters)
  ↑ 注册/查询
  │
registry.getCombatZone()
  ↑ 消费
  ├── StageController (controller.ts)
  ├── CombatActivity (combat.ts)
  └── Session (session/index.ts)
```

## 目录结构

```
src/core/content/
├── types.ts         # [MODIFY] EncounterId→CombatZoneId, EncounterDef→CombatZoneDef, EncounterWaveSelection→CombatZoneWaveSelection, ContentDb.encounters→combatZones, emptyContentDb, LocationEntryDef.encounterId→combatZoneId
├── registry.ts      # [MODIFY] encounters→combatZones, getEncounter→getCombatZone, 错误消息
└── index.ts         # 桶导出，无需手动改（自动跟随 types 导出）

src/core/stage/
├── types.ts         # [MODIFY] ActiveCombatWaveSession.encounterId→combatZoneId, StageSession.encounterId→combatZoneId + 注释
└── controller.ts    # [MODIFY] import, 接口字段, 函数参数名/类型, 局部变量, 内部函数名 pickEncounterWave→pickCombatZoneWave, 错误消息, 顶部设计注释

src/core/activity/
└── combat.ts        # [MODIFY] import getEncounter→getCombatZone, 所有 session.encounterId→session.combatZoneId, 注释

src/core/session/
└── index.ts         # [MODIFY] 注释中 encounterId, startFight 参数名, startStageInstance 选项, rehydrate 中字段访问

src/core/events/
└── index.ts         # [MODIFY] waveResolved.encounterId→combatZoneId

src/content/
└── index.ts         # [MODIFY] import, 变量类型标注, id 字符串 encounter.forest.*→zone.forest.*, ContentDb.encounters→combatZones

src/ui/
└── App.tsx          # [MODIFY] entry.encounterId→entry.combatZoneId

tests/fixtures/
└── content.ts       # [MODIFY] import, forestEncounter→forestCombatZone, id 字符串, encounters→combatZones

tests/core/
├── activity.test.ts          # [MODIFY] import + 全部 forestEncounter→forestCombatZone + encounterId
├── catch-up-integration.test.ts  # [MODIFY] import + 使用
├── session.test.ts           # [MODIFY] import + 使用
└── pending-loot.test.ts      # [MODIFY] import + encounterId→combatZoneId

docs/modules/
├── stage-activity.md  # [MODIFY] EncounterDef→CombatZoneDef, getEncounter→getCombatZone, 节标题等
├── session.md         # [MODIFY] startFight(encounterId)→startFight(combatZoneId)
└── combat.md          # [MODIFY] encounter→combat zone

docs/
└── roadmap.md         # [MODIFY] encounter.forest.* → zone.forest.*, encounter 功能描述
```

## Agent Extensions

### SubAgent

- **code-explorer**
- Purpose: 在最终验证阶段，扫描全项目确认无 encounter 残留引用
- Expected outcome: 确认 `rg -i encounter src/ tests/` 无残留匹配（docs 中的概念说明除外）
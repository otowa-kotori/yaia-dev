// UI text table — single source of truth for all player-facing UI strings.
//
// Content-layer display text (item names, monster names, skill names, etc.)
// lives in content/index.ts directly as Chinese strings. This file only
// covers UI chrome: labels, status messages, section titles, button text, etc.
//
// Convention: tsx files should NOT contain bare Chinese literals (comments
// excluded). Import from here instead. Run the following to audit:
//   rg '[\u4e00-\u9fff]' src/ui/*.tsx --glob '!text.ts' -n

export const T = {
  // ── Tabs ──
  tab_map: "地图 & 战斗",
  tab_log: "日志",
  tab_inventory: "背包",
  tab_crafting: "合成",
  tab_xp: "经验总览",
  tab_upgrades: "全局升级",
  tab_settings: "设置",
  tab_debug: "调试",


  // ── Character bar / status ──
  status_idle: "待命",
  status_inCombat: "战斗中",
  status_gathering: "采集中",
  status_inDungeon: "副本中",

  // ── Map & combat tab ──
  label_location: "地点:",
  entry_combat: "战斗",
  entry_gather: "采集",
  btn_stop: "停止",
  btn_cancel: "取消",
  btn_enterDungeon: "进入副本",
  btn_startCombat: "开始战斗",
  btn_abandonDungeon: "放弃副本",
  btn_stopCombat: "停止战斗",
  dialogClose: "关闭窗口",

  // ── Party dialog (unified) ──
  partyDialogTitle: "选择出战角色",
  partyHintCombat: "选择要派遣到该区域的角色。多人组队共享战场和奖励。",
  partyHintDungeon: "请选择要进入副本的角色。未选择的角色会保持当前状态。",
  partySelected: "已选择 {count} 名角色",
  partyLimitRange: "人数限制：{min} - {max}",
  partyInvalid: "当前选择不符合人数限制。",

  // ── Legacy dungeon party keys (kept for DungeonStatusPanel) ──
  dungeonPartyTitle: "选择出战角色",
  dungeonPartyHint: "请选择要进入副本的角色。未选择的角色会保持当前状态。",
  dungeonPartySelected: "已选择 {count} 名角色",
  dungeonPartyLimitRange: "人数限制：{min} - {max}",
  dungeonPartyLimitMin: "至少需要 {min} 名角色",
  dungeonPartyLimitMax: "最多允许 {max} 名角色",
  dungeonPartyInvalid: "当前选择不符合副本人数限制。",
  confirmAbandonDungeon: "确定要放弃当前副本吗？未完成的进度将丢失。",


  // ── Battle view ──
  pickLocation: "选择一个地点开始冒险。",
  deathRecovering: "死亡恢复中...",
  searchingEnemies: "搜索敌人中（休整）...",

  inCombat: "战斗中",
  stopped: "已停止",
  enemies: "敌人",
  combatPartyLabel: "队伍",
  gatheringLabel: "采集中",
  stageEmpty: "场景为空 — 等待刷新...",
  inThisStage: "当前场景",

  // ── Hero card / dungeon ──
  status_hero_inCombat: "战斗中",
  status_hero_deathRecovering: "死亡恢复中",
  status_hero_searching: "搜索/休整中",

  status_hero_idle: "待命",
  status_hero_gathering: "采集中",
  status_hero_dungeon: "副本中",
  dungeonPanelTitle: "副本状态",
  dungeonCurrentWave: "当前波次",
  dungeonPhaseLabel: "阶段",
  dungeonPartyLabel: "队伍",
  dungeonEnemyLabel: "当前敌人",
  activityLogTitle: "当前日志",
  activityLogEmpty: "当前范围暂无日志。",
  gameLogTitle: "全局日志",
  gameLogEmpty: "当前还没有新的旅程记录。",
  logCategory_world: "地点",
  logCategory_activity: "活动",
  logCategory_battle: "战斗",
  logCategory_reward: "奖励",
  logCategory_inventory: "物品",
  logCategory_economy: "经济",
  logCategory_growth: "成长",
  logCategory_dungeon: "副本",
  dungeonNoEnemy: "本波敌人尚未出现。",

  dungeonNoParty: "当前没有可展示的队伍成员。",
  dungeonNoLog: "当前阶段暂无战斗日志。",
  dungeonProgress: "第 {current} / {total} 波",

  dungeonPhase_spawningWave: "准备下一波",
  dungeonPhase_fighting: "战斗中",
  dungeonPhase_waveCleared: "波次已清理",
  dungeonPhase_waveResting: "波间休整",

  dungeonPhase_completed: "已通关",
  dungeonPhase_failed: "挑战失败",
  dungeonPhase_abandoned: "已放弃",
  ko: "阵亡",


  // ── Inventory ──
  equipFailed: "装备失败",
  unequipFailed: "卸下失败",
  itemDetails: "物品详情",
  itemDetailsHint: "点击背包中的物品后，这里会显示它的来源、类型、属性和操作入口。",
  missingItemDef: "缺少物品定义：",
  label_type: "类型",
  type_material: "材料",
  type_equipment: "装备",
  label_quantity: "数量",
  label_equipSlot: "装备槽位",
  label_instance: "实例",
  label_tags: "标签",
  modifierEffects: "属性效果",
  noModifiers: "无属性加成",
  equipTo: "装备到{name}",
  equipPanel: "装备面板",
  unequipped: "未装备",
  btn_unequip: "卸下",
  noBag: "— 无背包 —",
  bagShared: "共享仓库",
  heroBag: "{name}的背包",

  // ── Pending loot ──
  pendingLoot: "待拾取",
  pendingLootHint: "背包已满，以下物品暂存于场景中。离开场景后未拾取的物品将丢失。",
  pendingLootEmpty: "无待拾取物品",
  btn_pickUp: "拾取",
  btn_pickUpAll: "全部拾取",
  pickUpFailed: "背包仍然已满",
  confirmLeavePendingLoot: "你有物品尚未拾取，离开后将丢失。确定要切换地点吗？",

  // ── Crafting ──
  craftingTitle: "合成",
  craftingNoBag: "角色背包不存在，无法进行合成。",
  craftingNoRecipes: "当前还没有可用配方。",
  craftingBench: "合成台",
  craftingBenchHint:
    "用背包里的材料直接制作装备。当前制作会立刻完成；后续如果做排队或耗时条，再接到同一套配方数据上。",
  craftFailed: "合成失败",
  btn_craft: "合成",
  materialsRequired: "材料需求",
  outputResults: "产出结果",
  currentSkillLv: "当前技能 Lv",
  materialsSufficient: "材料齐全",
  notInActivity: "当前未在活动中",

  // ── Upgrades ──
  currency_gold: "金币",
  noCurrencyHint: "尚无货币 — 打怪获得金币！",
  noUpgrades: "暂无可用升级。",
  currentBonus: "当前加成：",
  maxLevel: "已满级",
  btn_upgrade: "升级",

  // ── XP overview ──
  section_character: "角色",
  section_attributes: "属性",
  section_skills: "技能",
  noHeroYet: "尚无英雄。",
  noSkillsYet: "尚未习得技能。试试去采集！",
  label_maxHp: "生命上限",
  label_maxMp: "法力上限",
  label_patk: "物攻",
  label_matk: "法攻",
  label_pdef: "物防",
  label_mres: "魔抗",
  label_str: "力量",
  label_dex: "敏捷",
  label_int: "智力",
  label_spd: "速度",

  // ── Talents ──
  tab_talents: "天赋",
  talentTitle: "天赋加点",
  talentHint: "每级获得 3 点天赋点，可自由分配到已解锁的天赋中。",
  talentEmpty: "当前职业暂无可用天赋。",
  talentTpLabel: "TP",
  talentTpAvailable: "可用 {available} / 总计 {total}",
  talentPrereqNotMet: "前置：{name} Lv{level}",
  talentAllocFailed: "加点失败",
  btn_allocateTalent: "+1",
  talentMaxLevel: "已满级",
  talentType_active: "主动",
  talentType_passive: "被动",
  talentType_sustain: "姿态",

  // ── Talent equip ──
  talentEquipTitle: "技能装备",
  talentEquipHint: "只有装备的主动/姿态技能才能在战斗中使用。被动技能始终生效。",
  talentSlotsFull: "槽位已满",
  talentEquipped: "已装备",
  btn_equipTalent: "装备",
  btn_unequipTalent: "卸下",
  talentEquipFailed: "技能装备失败",
  talentUnequipFailed: "技能卸下失败",

  // ── Settings ──
  speed: "速度",
  pause: "暂停",
  dangerZone: "危险区域",
  confirmClearSave: "清除存档并重置？此操作不可撤销。",
  btn_clearSave: "清除存档",

  // ── Catch-up overlay (global) ──
  catchUpInProgress: "正在恢复离线进度…",
  catchUpProgressLabel: "{done} / {total}",
  catchUpCancel: "取消",
  catchUpDone: "离线追帧完成，已补跑 {ticks} tick",
  catchUpCancelled: "追帧已取消，已跑 {ticks} tick",

  // ── Debug panel ──
  debugTools: "调试工具",
  debugOnlyInDev: "仅在开发环境可见",
  debugOverview: "运行概览",
  debugActorInspector: "Actor 检视",
  debugActorSelect: "选择 Actor",
  debugActorNone: "当前没有可检视的 Actor。",
  debugActorNoSelection: "未选中 Actor。",
  debugActorAttrs: "属性",
  debugActorEffectsTitle: "效果",
  debugActorKind: "类型",
  debugActorKind_player: "玩家",
  debugActorKind_enemy: "敌人",
  debugActorKind_resourceNode: "资源点",
  debugActorId: "ID",
  debugActorLevel: "等级",
  debugActorHp: "生命",
  debugActorMp: "法力",
  debugActorLocation: "地点",
  debugActorStage: "Stage",
  debugActorHeroConfig: "英雄模板",
  debugActorDefId: "定义",
  debugActorEffectCount: "效果数",
  debugActorNoCharacterData: "该 Actor 不提供角色属性与效果数据。",
  debugActorEffectsEmpty: "当前没有 active effects。",
  debugEffectId: "效果 ID",
  debugEffectInfinite: "永久",
  debugEffectActions: "{count} 行动",
  debugEffectStacks: "层数 ×{count}",
  debugEffectSourceTalent: "来源天赋",
  debugEffectSourceActor: "来源 Actor",
  debugEffectTags: "标签",
  debugEffectModifiers: "属性变化",
  debugEffectState: "实例状态",
  debugEffectReactions: "该效果只提供反应钩子",
  debugCheats: "作弊面板",
  debugCheatTargetHero: "目标角色",
  debugCheatNoHero: "当前没有可操作的角色。",
  debugCheatTime: "跳时间",
  debugCheatTimeHint: "直接走统一离线追帧管线。",
  debugCheatLevels: "直接升级",
  debugCheatLevelsHint: "按等级需求补足 XP，并复用正常升级成长。",
  debugCheatGrantLevels: "提升等级",
  debugCheatItems: "创造道具",
  debugCheatItemId: "道具 ID",
  debugCheatItemQty: "数量",
  debugCheatGiveItem: "创造道具",
  debugResolvedItem: "当前道具：{name}",
  debugCatchUp: "模拟追帧",
  debugCatchUpHint: "模拟离线指定小时数后恢复，走统一追帧管线。",
  debugCatchUpHours: "小时",
  debugCatchUpRun: "执行追帧",
  debugCatchUpQueued: "已开始模拟追帧。",
  debugTick: "逻辑 tick",
  debugWallClock: "上次存档时间",
  debugActors: "Actor 数",
  debugSpeed: "当前倍率",
  debugInvalidPositiveNumber: "请输入大于 0 的数值。",
  debugInvalidPositiveInteger: "请输入大于 0 的整数。",
  debugUnknownItem: "请输入有效的道具 ID。",
  debugActionError: "调试操作失败。",
  debugLevelUpDone: "{name} 提升了 {levels} 级。",
  debugLevelUpMaxed: "{name} 已达到等级上限。",
  debugGiveItemDone: "已向 {name} 发放 {qty} 个 {itemName}。",
} as const;

// ── Equipment slot labels ──
// Shared between InventoryView and CraftingView (previously duplicated).

const SLOT_LABELS: Record<string, string> = {
  weapon: "武器",
  offhand: "副手",
  helmet: "头部",
  chest: "胸甲",
  gloves: "手部",
  boots: "鞋子",
  ring: "戒指",
  amulet: "项链",
};

export function slotLabel(slot: string): string {
  return SLOT_LABELS[slot] ?? slot;
}

// ── Currency display names ──

const CURRENCY_NAMES: Record<string, string> = {
  "currency.gold": T.currency_gold,
};

export function currencyName(id: string): string {
  return CURRENCY_NAMES[id] ?? id;
}

// ── Format helper ──
// Simple {key} placeholder replacement. Keeps word order inside the template
// so a future locale swap only changes the template string, not call sites.
//   fmt(T.heroBag, { name: "勇者" })  →  "勇者的背包"
//   fmt("Hello {name}!", { name: "World" })  →  "Hello World!"

export function fmt(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => String(vars[key] ?? `{${key}}`));
}

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
  tab_inventory: "背包",
  tab_crafting: "合成",
  tab_xp: "经验总览",
  tab_upgrades: "全局升级",
  tab_settings: "设置",

  // ── Character bar / status ──
  status_idle: "待命",
  status_inCombat: "战斗中",
  status_gathering: "采集中",

  // ── Map & combat tab ──
  label_location: "地点:",
  entry_combat: "战斗",
  entry_gather: "采集",
  btn_stop: "停止",

  // ── Battle view ──
  pickLocation: "选择一个地点开始冒险。",
  recovering: "从战败中恢复...",
  waitingForEnemies: "等待敌人刷新...",
  inCombat: "战斗中",
  stopped: "已停止",
  enemies: "敌人",
  gatheringLabel: "采集中",
  stageEmpty: "场景为空 — 等待刷新...",
  inThisStage: "当前场景",

  // ── Hero card ──
  status_hero_inCombat: "战斗中",
  status_hero_recovering: "恢复中",
  status_hero_waiting: "等待中",
  status_hero_idle: "待命",
  status_hero_gathering: "采集中",
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
  label_atk: "攻击",
  label_def: "防御",
  label_str: "力量",
  label_dex: "敏捷",
  label_int: "智力",
  label_wis: "感知",
  label_spd: "速度",

  // ── Settings ──
  speed: "速度",
  pause: "暂停",
  dangerZone: "危险区域",
  confirmClearSave: "清除存档并重置？此操作不可撤销。",
  btn_clearSave: "清除存档",
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

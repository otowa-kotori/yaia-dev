// content/default/npcs.ts — NPC 与对话内容
//
// 示例：翠风草原·老兵 Aldric
// 覆盖所有节点类型：say → choice → condition → action → end
// 条件对话：完成初次对话（flag: "talked.aldric"）后换一组台词。

import type { DialogueDef, DialogueId, NpcDef, NpcId } from "../../core/content/types";

// ── 对话：第一次见面 ── //

export const dialogueAldricFirstMeet: DialogueDef = {
  id: "dialogue.aldric.first_meet" as DialogueId,
  entry: "entry",
  nodes: {
    // 条件路由：已见过 Aldric 则跳到日常问候，否则进首次剧情
    entry: {
      id: "entry",
      kind: "condition",
      branches: [
        { condition: { type: "hasFlag", flagId: "talked.aldric" }, next: "greet_returning" },
      ],
      fallback: "intro_1",
    },

    // ── 首次见面流程 ──
    intro_1: {
      id: "intro_1",
      kind: "say",
      speaker: "老兵 Aldric",
      text: "啊，新来的旅行者。这片草原看起来平静，但别被骗了——史莱姆群体最近变得异常活跃。",
      next: "intro_2",
    },
    intro_2: {
      id: "intro_2",
      kind: "say",
      speaker: "老兵 Aldric",
      text: "我在这里守了二十年，从没见过它们聚集成这样的规模。背后一定有什么在驱动它们。",
      next: "choice_1",
    },
    choice_1: {
      id: "choice_1",
      kind: "choice",
      speaker: "老兵 Aldric",
      text: "你来这里是为了什么？",
      choices: [
        {
          label: "我在寻找强敌磨砺自己。",
          next: "reply_fighter",
        },
        {
          label: "只是路过，顺便看看。",
          next: "reply_traveler",
        },
        {
          label: "（需要 Lv 3）我已经听说了史莱姆异变的事。",
          condition: { type: "playerLevel", min: 3 },
          next: "reply_informed",
        },
      ],
    },
    reply_fighter: {
      id: "reply_fighter",
      kind: "say",
      speaker: "老兵 Aldric",
      text: "好志向。草原深处有更强的敌人，但先从草原入口练起——别急着送死。",
      next: "mark_talked",
    },
    reply_traveler: {
      id: "reply_traveler",
      kind: "say",
      speaker: "老兵 Aldric",
      text: "路过的人多了，留下来的少。希望你能在这里找到值得停留的理由。",
      next: "mark_talked",
    },
    reply_informed: {
      id: "reply_informed",
      kind: "say",
      speaker: "老兵 Aldric",
      text: "你已经知道了？那就更好，少废话。我们需要有实力的人去调查草原腹地，我会记住你的名字。",
      next: "mark_talked",
    },

    // 记录已见过 Aldric，然后结束
    mark_talked: {
      id: "mark_talked",
      kind: "action",
      actions: [{ type: "setFlag", flagId: "talked.aldric" }],
      next: "farewell_first",
    },
    farewell_first: {
      id: "farewell_first",
      kind: "say",
      speaker: "老兵 Aldric",
      text: "去吧。有问题再来找我。",
      next: "end_node",
    },

    // ── 回访问候流程 ──
    greet_returning: {
      id: "greet_returning",
      kind: "say",
      speaker: "老兵 Aldric",
      text: "又来了。草原情况有变化吗？",
      next: "choice_returning",
    },
    choice_returning: {
      id: "choice_returning",
      kind: "choice",
      choices: [
        {
          label: "我有问题想问你。",
          next: "returning_question",
        },
        {
          label: "只是来打个招呼。",
          next: "returning_farewell",
        },
      ],
    },
    returning_question: {
      id: "returning_question",
      kind: "say",
      speaker: "老兵 Aldric",
      text: "说吧，我知道的都会告诉你。不过有些事……就算我知道，也不一定该说。",
      next: "end_node",
    },
    returning_farewell: {
      id: "returning_farewell",
      kind: "say",
      speaker: "老兵 Aldric",
      text: "没事就好。保持警觉。",
      next: "end_node",
    },

    end_node: {
      id: "end_node",
      kind: "end",
    },
  },
};

// ── NPC 定义 ──

export const npcAldric: NpcDef = {
  id: "npc.aldric" as NpcId,
  name: "老兵 Aldric",
  dialogueId: dialogueAldricFirstMeet.id,
};

// ── 注册表 ──

export const npcs: Record<string, NpcDef> = {
  [npcAldric.id]: npcAldric,
};

export const dialogues: Record<string, DialogueDef> = {
  [dialogueAldricFirstMeet.id]: dialogueAldricFirstMeet,
};

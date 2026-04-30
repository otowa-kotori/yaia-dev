// QuestPanel — 任务面板，展示可接取、进行中、可提交、已完成任务。
//
// 非调试用途——这是玩家正常使用的任务日志界面。

import type { GameStore } from "../store";
import { useStore } from "../hooks/useStore";
import { getContent } from "../../core/content";
import type { QuestDef, QuestObjectiveDef } from "../../core/content/types";
import type { QuestInstance } from "../../core/infra/state/types";
import { T } from "../text";
import { Card } from "../components/Card";
import { RewardDisplay } from "../components/RewardDisplay";

export function QuestPanel({ store }: { store: GameStore }) {
  const { store: s } = useStore(store);
  const content = getContent();

  const available = s.getAvailableQuests();
  const allInstances = Object.values(s.state.quests);
  const active = allInstances.filter((q) => q.status === "active");
  const ready = allInstances.filter((q) => q.status === "ready");
  const completed = allInstances.filter((q) => q.status === "completed");

  return (
    <div className="flex flex-col gap-4">
      {/* 可提交 */}
      {ready.length > 0 && (
        <Card className="p-3">
          <SectionHeader>{T.quest_section_ready}</SectionHeader>
          <div className="flex flex-col gap-3">
            {ready.map((inst) => (
              <QuestCard
                key={inst.questId}
                instance={inst}
                def={content.quests[inst.questId]}
                actions={[
                  { label: T.quest_btn_turnIn, onClick: () => s.turnInQuest(inst.questId), variant: "primary" },
                  { label: T.quest_btn_abandon, onClick: () => s.abandonQuest(inst.questId) },
                ]}
                statusBadge={T.quest_status_ready}
                statusColor="text-yellow-300"
              />
            ))}
          </div>
        </Card>
      )}

      {/* 进行中 */}
      {active.length > 0 && (
        <Card className="p-3">
          <SectionHeader>{T.quest_section_active}</SectionHeader>
          <div className="flex flex-col gap-3">
            {active.map((inst) => (
              <QuestCard
                key={inst.questId}
                instance={inst}
                def={content.quests[inst.questId]}
                actions={[
                  { label: T.quest_btn_abandon, onClick: () => s.abandonQuest(inst.questId) },
                ]}
              />
            ))}
          </div>
        </Card>
      )}

      {/* 可接取 */}
      {available.length > 0 && (
        <Card className="p-3">
          <SectionHeader>{T.quest_section_available}</SectionHeader>
          <div className="flex flex-col gap-3">
            {available.map((qid) => {
              const def = content.quests[qid];
              if (!def) return null;
              return (
                <AvailableQuestCard
                  key={qid}
                  def={def}
                  onAccept={() => s.acceptQuest(qid)}
                />
              );
            })}
          </div>
        </Card>
      )}

      {/* 已完成 */}
      {completed.length > 0 && (
        <Card className="p-3">
          <SectionHeader>{T.quest_section_completed}</SectionHeader>
          <div className="flex flex-col gap-2">
            {completed.map((inst) => {
              const def = content.quests[inst.questId];
              return (
                <div key={inst.questId} className="flex items-center justify-between text-xs opacity-60">
                  <span className="font-medium">{def?.name ?? inst.questId}</span>
                  {inst.completionCount && inst.completionCount > 1 && (
                    <span className="text-[10px] opacity-50 ml-2">
                      {T.quest_completionCount.replace("{n}", String(inst.completionCount))}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </Card>
      )}

      {/* 空状态 */}
      {active.length === 0 && ready.length === 0 && available.length === 0 && completed.length === 0 && (
        <Card className="p-3">
          <div className="text-xs opacity-50 text-center py-6">{T.quest_empty}</div>
        </Card>
      )}
    </div>
  );
}

// ── Sub-components ──

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[11px] opacity-55 tracking-wide uppercase mb-2">
      {children}
    </div>
  );
}

interface QuestAction {
  label: string;
  onClick: () => void;
  variant?: "primary" | "default";
}

function QuestCard({
  instance,
  def,
  actions,
  statusBadge,
  statusColor,
}: {
  instance: QuestInstance;
  def: QuestDef | undefined;
  actions: QuestAction[];
  statusBadge?: string;
  statusColor?: string;
}) {
  if (!def) return null;

  return (
    <div className="bg-[#1a1a2e] rounded-lg p-3 border border-[#2a2a4a]">
      {/* Header */}
      <div className="flex items-start justify-between gap-2 mb-2">
        <div>
          <div className="text-sm font-semibold text-white flex items-center gap-2">
            {def.name}
            {statusBadge && (
              <span className={`text-[10px] font-normal ${statusColor ?? "opacity-60"}`}>
                {statusBadge}
              </span>
            )}
            {def.repeatable && (
              <span className="text-[10px] font-normal text-purple-400">{T.quest_tag_repeatable}</span>
            )}
          </div>
          <div className="text-xs opacity-60 mt-0.5">{def.description}</div>
        </div>
        <div className="flex gap-1.5 shrink-0">
          {actions.map((action) => (
            <button
              key={action.label}
              onClick={action.onClick}
              className={`px-2.5 py-1 text-[11px] rounded border cursor-pointer font-[inherit] ${
                action.variant === "primary"
                  ? "border-green-700/60 bg-green-950/40 text-green-200 hover:bg-green-900/40"
                  : "border-[#4b657c] bg-[#2a2a2a] text-white hover:bg-[#333]"
              }`}
            >
              {action.label}
            </button>
          ))}
        </div>
      </div>

      {/* Objectives */}
      <div className="flex flex-col gap-1.5 mb-2">
        {def.objectives.map((obj, i) => (
          <ObjectiveRow key={i} obj={obj} progress={instance.progress[i] ?? 0} />
        ))}
      </div>

      {/* Rewards */}
      {def.rewards && (
        <div className="mt-2 pt-2 border-t border-[#2a2a4a]">
          <div className="text-[10px] opacity-40 mb-1">{T.quest_rewards}</div>
          <RewardDisplay bundle={def.rewards} />
        </div>
      )}
    </div>
  );
}

function AvailableQuestCard({
  def,
  onAccept,
}: {
  def: QuestDef;
  onAccept: () => void;
}) {
  return (
    <div className="bg-[#1a1a2e] rounded-lg p-3 border border-[#2a2a4a]">
      <div className="flex items-start justify-between gap-2 mb-2">
        <div>
          <div className="text-sm font-semibold text-white flex items-center gap-2">
            {def.name}
            {def.repeatable && (
              <span className="text-[10px] font-normal text-purple-400">{T.quest_tag_repeatable}</span>
            )}
          </div>
          <div className="text-xs opacity-60 mt-0.5">{def.description}</div>
        </div>
        <button
          onClick={onAccept}
          className="shrink-0 px-2.5 py-1 text-[11px] rounded border border-blue-700/60 bg-blue-950/40 text-blue-200 cursor-pointer hover:bg-blue-900/40 font-[inherit]"
        >
          {T.quest_btn_accept}
        </button>
      </div>

      {/* Rewards preview */}
      {def.rewards && (
        <div className="mt-2 pt-2 border-t border-[#2a2a4a]">
          <div className="text-[10px] opacity-40 mb-1">{T.quest_rewards}</div>
          <RewardDisplay bundle={def.rewards} />
        </div>
      )}
    </div>
  );
}

function ObjectiveRow({
  obj,
  progress,
}: {
  obj: QuestObjectiveDef;
  progress: number;
}) {
  const target = obj.kind === "event" ? obj.targetCount : 1;
  const current = Math.min(progress, target);
  const done = current >= target;
  const pct = target > 0 ? Math.min(current / target, 1) : 0;

  return (
    <div className="flex items-center gap-2">
      {/* Checkbox */}
      <span className={`text-xs ${done ? "text-green-400" : "opacity-40"}`}>
        {done ? "\u2713" : "\u25cb"}
      </span>

      {/* Description + progress */}
      <div className="flex-1 min-w-0">
        <div className={`text-xs ${done ? "text-green-300 line-through opacity-60" : "text-gray-300"}`}>
          {obj.description}
        </div>
        {/* Progress bar */}
        {!done && (
          <div className="mt-1 h-1 bg-[#333] rounded-full overflow-hidden">
            <div
              className="h-full bg-blue-500 rounded-full transition-all duration-300"
              style={{ width: `${pct * 100}%` }}
            />
          </div>
        )}
      </div>

      {/* Counter */}
      <span className={`text-[11px] tabular-nums shrink-0 ${done ? "text-green-400" : "opacity-50"}`}>
        {current}/{target}
      </span>
    </div>
  );
}

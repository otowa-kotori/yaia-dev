// Talent allocation + equip panel.
//
// Shows the hero's available talent points (TP) and a card for each talent
// available to the hero's class. Cards show: name, type badge, level progress,
// description, prereqs, equip state, and action buttons.

import { useState } from "react";
import {
  createTalentStaticContext,
  DEFAULT_TALENT_ACTION_COST_RATIO,
  getContent,
  resolveTalentActiveParams,
  type ResolvedTalentActiveParams,
} from "../../core/content";
import type { TalentDef } from "../../core/content/types";
import { getAttr } from "../../core/entity/actor";
import { ATTR } from "../../core/entity/attribute";
import { computeAvailableTp, computeTotalTp } from "../../core/growth/talent";
import type { GameStore } from "../store";
import { useStore } from "../hooks/useStore";
import { T, fmt } from "../text";
import { TalentIcon } from "../components/TalentIcon";
import { Card } from "../components/Card";
import { Badge } from "../components/Badge";
import { ProgressBar } from "../components/ProgressBar";

export function TalentPanel({ store }: { store: GameStore }) {
  const { store: s } = useStore(store);
  const cc = s.focused;
  const hero = cc.hero;
  const [error, setError] = useState<string | null>(null);

  if (!hero) {
    return <div className="opacity-50 text-sm mt-3">{T.noHeroYet}</div>;
  }

  const content = getContent();
  const heroCfg = content.starting?.heroes.find(h => h.id === hero.heroConfigId);
  const availableTalentIds = heroCfg?.availableTalents ?? [];
  const totalTp = computeTotalTp(hero.level);
  const availableTp = computeAvailableTp(hero.level, hero.talentLevels, content.talents);
  const talentSlots = Math.max(0, Math.floor(getAttr(hero, ATTR.TALENT_SLOTS)));
  const equippedCount = hero.equippedTalents.length;
  const equippedSlots = Array.from({ length: talentSlots }, (_, index) => hero.equippedTalents[index] ?? null);

  return (
    <div className="flex flex-col gap-3">
      {/* TP header */}
      <Card className="px-3 py-2 flex justify-between items-center">
        <div>
          <span className="text-[11px] opacity-50 uppercase tracking-wide">
            {T.talentTitle}
          </span>
          <div className="text-xs opacity-68 mt-1">{T.talentHint}</div>
        </div>
        <div className={`text-sm font-semibold tabular-nums ${availableTp > 0 ? "text-emerald-400" : "text-gray-500"}`}>
          {T.talentTpLabel}{" "}
          {fmt(T.talentTpAvailable, { available: availableTp, total: totalTp })}
        </div>
      </Card>

      {/* TP bar */}
      <ProgressBar
        value={totalTp - availableTp}
        max={totalTp}
        color="xp"
        size="sm"
      />

      {/* Equip slots header */}
      <div className="bg-[#1a2a2a] rounded border border-border px-3 py-1.5 flex justify-between items-center">
        <div>
          <span className="text-[11px] opacity-50">{T.talentEquipTitle}</span>
          <div className="text-[11px] opacity-50 mt-0.5">{T.talentEquipHint}</div>
        </div>
        <span className={`text-[13px] font-semibold tabular-nums ${equippedCount >= talentSlots ? "text-orange-400" : "text-blue-300"}`}>
          {equippedCount} / {talentSlots}
        </span>
      </div>

      {/* Equipped talent slots */}
      <div className="flex gap-2 flex-wrap px-0.5 pt-2">
        {equippedSlots.map((talentId, index) => {
          if (!talentId) {
            return (
              <div
                key={`empty-${index}`}
                title={`${T.talentEquipEmptySlot} ${index + 1}`}
                className="w-[50px] h-[50px] rounded-lg border border-dashed border-[#3d4b63] bg-[#14191f] flex flex-col items-center justify-center text-[#5f6d84] gap-0.5"
              >
                <span className="text-[11px] font-bold">{index + 1}</span>
                <span className="text-[9px] opacity-72">{T.talentEquipEmptySlot}</span>
              </div>
            );
          }

          const equippedDef = content.talents[talentId];
          if (!equippedDef) return null;
          const equippedLevel = hero.talentLevels[talentId] ?? 0;

          return (
            <div
              key={`${talentId}-${index}`}
              title={`${equippedDef.name} · Lv ${equippedLevel}`}
              className="w-[50px] flex flex-col items-center gap-1"
            >
              <div className="relative">
                <TalentIcon talentId={talentId} alt={equippedDef.name} size={50} />
                <div className="absolute -left-1 -top-1 min-w-4 h-4 px-1 rounded-full bg-[#203a57] text-[#bfe2ff] border border-[#31577d] text-[10px] font-bold flex items-center justify-center tabular-nums">
                  {index + 1}
                </div>
              </div>
              <div className="text-[9px] leading-tight text-[#95a7c7] text-center w-full whitespace-nowrap overflow-hidden text-ellipsis">
                {equippedDef.name}
              </div>
            </div>
          );
        })}
      </div>

      {/* Error banner */}
      {error && (
        <div className="px-2.5 py-2 bg-red-950/50 border border-red-800/60 rounded text-xs text-red-300">
          {error}
        </div>
      )}

      {/* Talent cards */}
      {availableTalentIds.length > 0 ? (
        <div className="grid grid-cols-2 gap-2">
          {availableTalentIds.map(id => {
            const def = content.talents[id as string];
            if (!def) return null;
            const currentLevel = hero.talentLevels[id as string] ?? 0;
            const maxed = currentLevel >= def.maxLevel;
            const currentStaticCtx = createTalentStaticContext(currentLevel, hero);
            const nextStaticCtx = createTalentStaticContext(currentLevel + 1, hero);
            const currentDescription = currentLevel > 0 && def.describe
              ? def.describe(currentStaticCtx)
              : null;
            const nextDescription = !maxed && def.describe
              ? def.describe(nextStaticCtx)
              : null;
            const currentActiveMeta = currentLevel > 0
              ? formatActiveMeta(resolveTalentActiveParams(def, currentStaticCtx))
              : null;
            const nextActiveMeta = !maxed
              ? formatActiveMeta(resolveTalentActiveParams(def, nextStaticCtx))
              : null;

            // Check prereqs for disable state.
            let prereqMet = true;
            let prereqHint = "";
            if (def.prereqs) {
              for (const prereq of def.prereqs) {
                const prereqLvl = hero.talentLevels[prereq.talentId as string] ?? 0;
                if (prereqLvl < prereq.minLevel) {
                  prereqMet = false;
                  const prereqDef = content.talents[prereq.talentId as string];
                  prereqHint = fmt(T.talentPrereqNotMet, {
                    name: prereqDef?.name ?? prereq.talentId,
                    level: prereq.minLevel,
                  });
                  break;
                }
              }
            }

            const canAllocate = !maxed && prereqMet && availableTp >= def.tpCost;
            const isEquipped = hero.equippedTalents.includes(id as string);
            const isEquippable = def.type === "active" || def.type === "sustain";
            const canEquip = isEquippable && currentLevel > 0 && !isEquipped && equippedCount < talentSlots;

            return (
              <TalentCard
                key={id}
                def={def}
                currentLevel={currentLevel}
                currentDescription={currentDescription}
                nextDescription={nextDescription}
                currentActiveMeta={currentActiveMeta}
                nextActiveMeta={nextActiveMeta}
                maxed={maxed}
                canAllocate={canAllocate}
                prereqHint={prereqHint}
                isEquipped={isEquipped}
                isEquippable={isEquippable}
                canEquip={canEquip}
                onAllocate={() => {
                  try {
                    cc.allocateTalent(id as string);
                    setError(null);
                  } catch (e) {
                    setError(e instanceof Error ? e.message : T.talentAllocFailed);
                  }
                }}
                onEquip={() => {
                  try {
                    cc.equipTalent(id as string);
                    setError(null);
                  } catch (e) {
                    setError(e instanceof Error ? e.message : T.talentEquipFailed);
                  }
                }}
                onUnequip={() => {
                  try {
                    cc.unequipTalent(id as string);
                    setError(null);
                  } catch (e) {
                    setError(e instanceof Error ? e.message : T.talentUnequipFailed);
                  }
                }}
              />
            );
          })}
        </div>
      ) : (
        <div className="opacity-45 text-[13px]">{T.talentEmpty}</div>
      )}
    </div>
  );
}

// ---------- TalentCard ----------

const TYPE_LABELS: Record<string, string> = {
  active: T.talentType_active,
  passive: T.talentType_passive,
  sustain: T.talentType_sustain,
};

const TYPE_BADGE_VARIANT: Record<string, "accent" | "info" | "warning"> = {
  active: "info",
  passive: "accent",
  sustain: "warning",
};

function formatActionCostRatio(ratio: number): string {
  return Number.isInteger(ratio)
    ? String(ratio)
    : ratio.toFixed(2).replace(/\.0+$/, "").replace(/(\.\d*[1-9])0+$/, "$1");
}

function formatActiveMeta(activeParams: ResolvedTalentActiveParams | null): string | null {
  if (!activeParams) return null;
  const parts: string[] = [];
  if (activeParams.mpCost > 0) {
    parts.push(fmt(T.talentMetaMp, { amount: activeParams.mpCost }));
  }
  if (activeParams.cooldownActions > 0) {
    parts.push(fmt(T.talentMetaCooldown, { count: activeParams.cooldownActions }));
  }
  if (activeParams.actionCostRatio !== DEFAULT_TALENT_ACTION_COST_RATIO) {
    parts.push(fmt(T.talentMetaActionCostRatio, { ratio: formatActionCostRatio(activeParams.actionCostRatio) }));
  }
  return parts.length > 0 ? parts.join(" · ") : null;
}

function TalentCard({
  def,
  currentLevel,
  currentDescription,
  nextDescription,
  currentActiveMeta,
  nextActiveMeta,
  maxed,
  canAllocate,
  prereqHint,
  isEquipped,
  isEquippable,
  canEquip,
  onAllocate,
  onEquip,
  onUnequip,
}: {
  def: TalentDef;
  currentLevel: number;
  currentDescription: string | null;
  nextDescription: string | null;
  currentActiveMeta: string | null;
  nextActiveMeta: string | null;
  maxed: boolean;
  canAllocate: boolean;
  prereqHint: string;
  isEquipped: boolean;
  isEquippable: boolean;
  canEquip: boolean;
  onAllocate: () => void;
  onEquip: () => void;
  onUnequip: () => void;
}) {
  const pct = def.maxLevel > 0 ? currentLevel / def.maxLevel : 0;
  const typeLabel = TYPE_LABELS[def.type] ?? def.type;
  const badgeVariant = TYPE_BADGE_VARIANT[def.type] ?? "neutral" as const;

  const borderClass = isEquipped
    ? "border-blue-500/60"
    : maxed
      ? "border-emerald-600/60"
      : "border-border";

  return (
    <div className={`bg-surface rounded p-2.5 flex flex-col gap-1.5 border ${borderClass}`}>
      {/* Header: name + type badge + level + equip indicator */}
      <div className="flex justify-between gap-2.5 items-start">
        <div className="flex gap-2 items-start min-w-0">
          <TalentIcon
            talentId={def.id as string}
            alt={def.name}
            size={36}
            dimmed={currentLevel <= 0}
          />
          <div className="flex flex-col gap-1 min-w-0">
            <div className="flex gap-1.5 items-center flex-wrap">
              <span className={`font-semibold text-[13px] ${maxed ? "text-emerald-400" : "text-gray-100"}`}>
                {def.name}
              </span>
              <Badge variant={badgeVariant}>{typeLabel}</Badge>
              {isEquipped && (
                <Badge variant="info">{T.talentEquipped}</Badge>
              )}
            </div>
            <div className="text-[10px] opacity-48">{def.id}</div>
          </div>
        </div>
        <span className="text-[11px] opacity-60 tabular-nums whitespace-nowrap">
          Lv {currentLevel} / {def.maxLevel}
        </span>
      </div>

      {/* Progress bar */}
      <div className="h-1 bg-[#111] rounded-sm overflow-hidden">
        <div
          className={`h-full transition-[width] duration-150 ${maxed ? "bg-emerald-600" : "bg-blue-500"}`}
          style={{ width: `${pct * 100}%` }}
        />
      </div>

      {/* Description */}
      {def.description && (
        <div className="text-xs opacity-70">{def.description}</div>
      )}

      {/* Level-specific description from describe */}
      {(currentDescription || nextDescription || currentActiveMeta || nextActiveMeta) && (
        <div className="text-[11px] opacity-55 -mt-0.5 flex flex-col gap-0.5">
          {currentDescription && (
            <div>Lv{currentLevel}: {currentDescription}</div>
          )}
          {currentActiveMeta && (
            <div className={`opacity-78 ${currentDescription ? "-mt-px" : ""}`}>↳ {currentActiveMeta}</div>
          )}
          {nextDescription && (
            <div className={`text-blue-300 ${currentActiveMeta ? "mt-0.5" : ""}`}>
              {currentLevel > 0 ? "→ " : ""}Lv{currentLevel + 1}: {nextDescription}
            </div>
          )}
          {nextActiveMeta && (
            <div className="text-blue-300 opacity-88">↳ {nextActiveMeta}</div>
          )}
        </div>
      )}

      {/* Prereq hint */}
      {prereqHint && (
        <div className="text-[11px] text-red-400 opacity-80">
          {prereqHint}
        </div>
      )}

      {/* Action buttons row */}
      <div className="flex gap-1.5 mt-0.5">
        {/* Allocate button */}
        {maxed ? (
          <div className="text-xs text-emerald-400 font-medium flex-1 text-center">
            {T.talentMaxLevel}
          </div>
        ) : (
          <button
            onClick={onAllocate}
            disabled={!canAllocate}
            className={`flex-1 px-2 py-1.5 text-xs rounded border font-[inherit] flex items-center justify-center gap-1 ${
              canAllocate
                ? "border-green-800 bg-green-950/50 text-green-300 cursor-pointer hover:bg-green-900/50"
                : "border-gray-700 bg-[#2a2a2a] text-gray-600 cursor-not-allowed"
            }`}
          >
            <span>{T.btn_allocateTalent}</span>
            <span className="opacity-50 text-[10px]">({def.tpCost} TP)</span>
          </button>
        )}

        {/* Equip/unequip button — only for active/sustain with level > 0 */}
        {isEquippable && currentLevel > 0 && (
          isEquipped ? (
            <button
              onClick={onUnequip}
              className="px-2 py-1.5 text-[11px] rounded border border-gray-600 bg-red-950/30 text-red-300 cursor-pointer hover:bg-red-900/30 font-[inherit]"
            >
              {T.btn_unequipTalent}
            </button>
          ) : (
            <button
              onClick={onEquip}
              disabled={!canEquip}
              className={`px-2 py-1.5 text-[11px] rounded border font-[inherit] ${
                canEquip
                  ? "border-gray-600 bg-blue-950/40 text-blue-300 cursor-pointer hover:bg-blue-900/40"
                  : "border-gray-600 bg-[#2a2a2a] text-gray-600 cursor-not-allowed"
              }`}
            >
              {T.btn_equipTalent}
            </button>
          )
        )}
      </div>
    </div>
  );
}

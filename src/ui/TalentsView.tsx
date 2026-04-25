// Talent allocation panel.
//
// Shows the hero's available talent points (TP) and a card for each talent
// available to the hero's class. Cards show: name, type badge, level progress,
// description, prereqs, and a +1 button.

import { useState } from "react";
import { getContent } from "../core/content";
import type { TalentDef } from "../core/content/types";
import { computeAvailableTp, computeTotalTp } from "../core/growth/talent";
import type { GameStore } from "./store";
import { useStore } from "./useStore";
import { T, fmt } from "./text";

export function TalentsView({ store }: { store: GameStore }) {
  const { store: s } = useStore(store);
  const cc = s.getFocusedCharacter();
  const hero = cc.hero;
  const [error, setError] = useState<string | null>(null);

  if (!hero) {
    return <div style={{ opacity: 0.5, fontSize: 14, marginTop: 12 }}>{T.noHeroYet}</div>;
  }

  const content = getContent();
  const heroCfg = content.starting?.heroes.find(h => h.id === hero.heroConfigId);
  const availableTalentIds = heroCfg?.availableTalents ?? [];
  const totalTp = computeTotalTp(hero.level);
  const availableTp = computeAvailableTp(hero.level, hero.talentLevels, content.talents);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {/* TP header */}
      <div style={{
        background: "#222", borderRadius: 4, padding: "8px 12px",
        display: "flex", justifyContent: "space-between", alignItems: "center",
      }}>
        <div>
          <span style={{ fontSize: 11, opacity: 0.5, textTransform: "uppercase", letterSpacing: 0.4 }}>
            {T.talentTitle}
          </span>
          <div style={{ fontSize: 12, opacity: 0.68, marginTop: 4 }}>{T.talentHint}</div>
        </div>
        <div style={{
          fontSize: 14, fontWeight: 600, fontVariantNumeric: "tabular-nums",
          color: availableTp > 0 ? "#4a9" : "#999",
        }}>
          {T.talentTpLabel}{" "}
          {fmt(T.talentTpAvailable, { available: availableTp, total: totalTp })}
        </div>
      </div>

      {/* TP bar */}
      <div style={{ height: 5, background: "#111", borderRadius: 2, overflow: "hidden" }}>
        <div style={{
          height: "100%",
          width: totalTp > 0 ? `${((totalTp - availableTp) / totalTp) * 100}%` : "0%",
          background: "#59c",
          transition: "width 150ms",
        }} />
      </div>

      {/* Error banner */}
      {error && (
        <div style={{
          padding: "8px 10px", background: "#3a1f1f", border: "1px solid #6d3636",
          borderRadius: 4, fontSize: 12, color: "#ffb3b3",
        }}>
          {error}
        </div>
      )}

      {/* Talent cards */}
      {availableTalentIds.length > 0 ? (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          {availableTalentIds.map(id => {
            const def = content.talents[id as string];
            if (!def) return null;
            const currentLevel = hero.talentLevels[id as string] ?? 0;
            const maxed = currentLevel >= def.maxLevel;

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

            return (
              <TalentCard
                key={id}
                def={def}
                currentLevel={currentLevel}
                maxed={maxed}
                canAllocate={canAllocate}
                prereqHint={prereqHint}
                onAllocate={() => {
                  try {
                    cc.allocateTalent(id as string);
                    setError(null);
                  } catch (e) {
                    setError(e instanceof Error ? e.message : T.talentAllocFailed);
                  }
                }}
              />
            );
          })}
        </div>
      ) : (
        <div style={{ opacity: 0.45, fontSize: 13 }}>{T.talentEmpty}</div>
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

const TYPE_COLORS: Record<string, string> = {
  active: "#59c",
  passive: "#9b9",
  sustain: "#c9a",
};

function TalentCard({
  def,
  currentLevel,
  maxed,
  canAllocate,
  prereqHint,
  onAllocate,
}: {
  def: TalentDef;
  currentLevel: number;
  maxed: boolean;
  canAllocate: boolean;
  prereqHint: string;
  onAllocate: () => void;
}) {
  const pct = def.maxLevel > 0 ? currentLevel / def.maxLevel : 0;
  const typeLabel = TYPE_LABELS[def.type] ?? def.type;
  const typeColor = TYPE_COLORS[def.type] ?? "#999";

  return (
    <div style={{
      background: "#222", borderRadius: 4, padding: 10,
      display: "flex", flexDirection: "column", gap: 6,
      border: maxed ? "1px solid #3a6" : "1px solid #333",
    }}>
      {/* Header: name + type badge + level */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <div style={{ display: "flex", gap: 6, alignItems: "baseline" }}>
          <span style={{ fontWeight: 600, fontSize: 13, color: maxed ? "#4a9" : "#eee" }}>
            {def.name}
          </span>
          <span style={{
            fontSize: 10, padding: "1px 5px", borderRadius: 3,
            border: `1px solid ${typeColor}`, color: typeColor,
          }}>
            {typeLabel}
          </span>
        </div>
        <span style={{ fontSize: 11, opacity: 0.6, fontVariantNumeric: "tabular-nums" }}>
          Lv {currentLevel} / {def.maxLevel}
        </span>
      </div>

      {/* Progress bar */}
      <div style={{ height: 4, background: "#111", borderRadius: 2, overflow: "hidden" }}>
        <div style={{
          height: "100%",
          width: `${pct * 100}%`,
          background: maxed ? "#3a6" : "#59c",
          transition: "width 150ms",
        }} />
      </div>

      {/* Description */}
      {def.description && (
        <div style={{ fontSize: 12, opacity: 0.7 }}>{def.description}</div>
      )}

      {/* Level-specific description from describeLevel */}
      {def.describeLevel && (
        <div style={{ fontSize: 11, opacity: 0.55, marginTop: -2 }}>
          {currentLevel > 0 && (
            <div>Lv{currentLevel}: {def.describeLevel(currentLevel)}</div>
          )}
          {!maxed && (
            <div style={{ color: "#9bd" }}>
              {currentLevel > 0 ? "→ " : ""}Lv{currentLevel + 1}: {def.describeLevel(currentLevel + 1)}
            </div>
          )}
        </div>
      )}

      {/* Prereq hint */}
      {prereqHint && (
        <div style={{ fontSize: 11, color: "#f88", opacity: 0.8 }}>
          {prereqHint}
        </div>
      )}

      {/* Allocate button or maxed label */}
      {maxed ? (
        <div style={{ fontSize: 12, color: "#4a9", fontWeight: 500, textAlign: "center", marginTop: 2 }}>
          {T.talentMaxLevel}
        </div>
      ) : (
        <button
          onClick={onAllocate}
          disabled={!canAllocate}
          style={{
            marginTop: 2, padding: "5px 10px", fontSize: 12, borderRadius: 4,
            border: "1px solid #444",
            background: canAllocate ? "#2a4a2a" : "#2a2a2a",
            color: canAllocate ? "#8d8" : "#666",
            cursor: canAllocate ? "pointer" : "not-allowed",
            fontFamily: "inherit",
            display: "flex", alignItems: "center", justifyContent: "center", gap: 4,
          }}
        >
          <span>{T.btn_allocateTalent}</span>
          <span style={{ opacity: 0.5, fontSize: 10 }}>({def.tpCost} TP)</span>
        </button>
      )}
    </div>
  );
}

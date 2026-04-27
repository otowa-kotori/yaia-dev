// XP & Skills overview panel.
//
// Shows:
//   - Hero card with level + XP progress bar
//   - Core attribute block (PATK / PDEF / STR / DEX / INT / SPD)
//   - Per-skill progress bars for every skill the hero has earned XP in

import { getAttr } from "../../core/entity/actor";
import { ATTR } from "../../core/entity/attribute";
import { getContent } from "../../core/content";
import { xpProgressToNextLevel } from "../../core/growth/leveling";
import type { GameStore } from "../store";
import { useStore } from "../hooks/useStore";
import { T } from "../text";
import { Card } from "../components/Card";
import { ProgressBar } from "../components/ProgressBar";

/** Attribute ids we want to display, in order. */
const DISPLAY_ATTRS: Array<{ id: string; label: string }> = [
  { id: ATTR.MAX_HP,  label: T.label_maxHp },
  { id: ATTR.MAX_MP,  label: T.label_maxMp },
  { id: ATTR.PATK,   label: T.label_patk },
  { id: ATTR.MATK,   label: T.label_matk },
  { id: ATTR.PDEF,   label: T.label_pdef },
  { id: ATTR.MRES,   label: T.label_mres },
  { id: ATTR.STR,    label: T.label_str },
  { id: ATTR.DEX,    label: T.label_dex },
  { id: ATTR.INT,    label: T.label_int },
  { id: ATTR.SPEED,  label: T.label_spd },
];

export function StatsPanel({ store }: { store: GameStore }) {
  const { store: s } = useStore(store);
  const hero = s.getFocusedCharacter().hero;
  if (!hero) {
    return (
      <div className="opacity-50 text-sm mt-3">
        {T.noHeroYet}
      </div>
    );
  }

  const xp = xpProgressToNextLevel(hero.level, hero.exp, hero.xpCurve);
  const skillEntries = Object.entries(hero.skills);
  const content = getContent();

  return (
    <div className="flex flex-col gap-3">
      {/* ── Hero level + XP ── */}
      <Card className="p-2.5">
        <div className="text-[11px] opacity-50 tracking-wide uppercase mb-2">
          {T.section_character}
        </div>
        <div className="flex justify-between mb-1.5">
          <span className="font-semibold">
            {hero.name} · Lv {hero.level}
          </span>
          <span className="text-xs opacity-60 tabular-nums">
            {hero.exp} / {xp.cost || "MAX"} XP
          </span>
        </div>
        <ProgressBar value={xp.pct * 100} max={100} color="xp" size="sm" />
      </Card>

      {/* ── Attributes ── */}
      <Card className="p-2.5">
        <div className="text-[11px] opacity-50 tracking-wide uppercase mb-2">
          {T.section_attributes}
        </div>
        <div className="grid grid-cols-4 gap-x-3 gap-y-1.5">
          {DISPLAY_ATTRS.map(({ id, label }) => {
            const val = Math.round(getAttr(hero, id));
            return (
              <div key={id} className="flex flex-col items-center">
                <span className="text-[10px] opacity-55 tracking-wide uppercase">
                  {label}
                </span>
                <span className="text-[15px] font-semibold tabular-nums">
                  {val}
                </span>
              </div>
            );
          })}
        </div>
      </Card>

      {/* ── Skills ── */}
      <Card className="p-2.5">
        <div className="text-[11px] opacity-50 tracking-wide uppercase mb-2">
          {T.section_skills}
        </div>
        {skillEntries.length === 0 ? (
          <div className="opacity-45 text-xs">{T.noSkillsYet}</div>
        ) : (
          <div className="flex flex-col gap-2">
            {skillEntries.map(([skillId, sp]) => {
              const def = content.skills[skillId];
              const name = def?.name ?? skillId;
              const curve = def?.xpCurve;
              const { cost, pct } = curve
                ? xpProgressToNextLevel(sp.level, sp.xp, curve)
                : { cost: 0, pct: 0 };
              return (
                <div key={skillId}>
                  <div className="flex justify-between mb-0.5">
                    <span className="text-[13px] font-medium">
                      {name} <span className="opacity-50 font-normal">Lv {sp.level}</span>
                    </span>
                    <span className="text-[11px] opacity-55 tabular-nums">
                      {sp.xp} / {cost || "MAX"}
                    </span>
                  </div>
                  <ProgressBar value={pct * 100} max={100} color="hp" size="sm" />
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
}

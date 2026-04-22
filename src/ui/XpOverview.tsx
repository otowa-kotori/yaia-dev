// XP & Skills overview tab.
//
// Shows:
//   - Hero card with level + XP progress bar
//   - Core attribute block (ATK / DEF / STR / DEX / INT / WIS / SPD)
//   - Per-skill progress bars for every skill the hero has earned XP in

import { getAttr } from "../core/actor";
import { ATTR } from "../core/attribute";
import { getContent } from "../core/content";
import { xpProgressToNextLevel } from "../core/progression";
import type { GameStore } from "./store";
import { useStore } from "./useStore";
import { buildDefaultContent } from "../content";
import { T } from "./text";

const ATTR_DEFS = buildDefaultContent().attributes;

/** Attribute ids we want to display, in order. */
const DISPLAY_ATTRS: Array<{ id: string; label: string }> = [
  { id: ATTR.MAX_HP, label: T.label_maxHp },
  { id: ATTR.ATK,    label: T.label_atk },
  { id: ATTR.DEF,    label: T.label_def },
  { id: ATTR.STR,    label: T.label_str },
  { id: ATTR.DEX,    label: T.label_dex },
  { id: ATTR.INT,    label: T.label_int },
  { id: ATTR.WIS,    label: T.label_wis },
  { id: ATTR.SPEED,  label: T.label_spd },
];

export function XpOverview({ store }: { store: GameStore }) {
  const { store: s } = useStore(store);
  const hero = s.getFocusedCharacter().hero;
  if (!hero) {
    return (
      <div style={{ opacity: 0.5, fontSize: 14, marginTop: 12 }}>
        {T.noHeroYet}
      </div>
    );
  }

  const xp = xpProgressToNextLevel(hero.level, hero.exp, hero.xpCurve);
  const skillEntries = Object.entries(hero.skills);
  const content = getContent();

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {/* ── Hero level + XP ── */}
      <Section title={T.section_character}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
          <span style={{ fontWeight: 600 }}>
            {hero.name} · Lv {hero.level}
          </span>
          <span style={{ fontSize: 12, opacity: 0.6, fontVariantNumeric: "tabular-nums" }}>
            {hero.exp} / {xp.cost || "MAX"} XP
          </span>
        </div>
        <Bar pct={xp.pct} color="#59c" />
      </Section>

      {/* ── Attributes ── */}
      <Section title={T.section_attributes}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(4, 1fr)",
            gap: "6px 12px",
          }}
        >
          {DISPLAY_ATTRS.map(({ id, label }) => {
            const val = Math.round(getAttr(hero, id, ATTR_DEFS));
            return (
              <div key={id} style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
                <span style={{ fontSize: 10, opacity: 0.55, letterSpacing: 0.5, textTransform: "uppercase" }}>
                  {label}
                </span>
                <span style={{ fontSize: 15, fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>
                  {val}
                </span>
              </div>
            );
          })}
        </div>
      </Section>

      {/* ── Skills ── */}
      <Section title={T.section_skills}>
        {skillEntries.length === 0 ? (
          <div style={{ opacity: 0.45, fontSize: 12 }}>{T.noSkillsYet}</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {skillEntries.map(([skillId, sp]) => {
              const def = content.skills[skillId];
              const name = def?.name ?? skillId;
              const curve = def?.xpCurve;
              const { cost, pct } = curve
                ? xpProgressToNextLevel(sp.level, sp.xp, curve)
                : { cost: 0, pct: 0 };
              return (
                <div key={skillId}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
                    <span style={{ fontSize: 13, fontWeight: 500 }}>
                      {name} <span style={{ opacity: 0.5, fontWeight: 400 }}>Lv {sp.level}</span>
                    </span>
                    <span style={{ fontSize: 11, opacity: 0.55, fontVariantNumeric: "tabular-nums" }}>
                      {sp.xp} / {cost || "MAX"}
                    </span>
                  </div>
                  <Bar pct={pct} color="#a74" />
                </div>
              );
            })}
          </div>
        )}
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ background: "#222", borderRadius: 4, padding: 10 }}>
      <div style={{ fontSize: 11, opacity: 0.5, letterSpacing: 0.5, textTransform: "uppercase", marginBottom: 8 }}>
        {title}
      </div>
      {children}
    </div>
  );
}

function Bar({ pct, color }: { pct: number; color: string }) {
  return (
    <div
      style={{
        height: 5,
        background: "#111",
        borderRadius: 2,
        overflow: "hidden",
      }}
    >
      <div
        style={{
          height: "100%",
          width: `${pct * 100}%`,
          background: color,
          transition: "width 100ms linear",
        }}
      />
    </div>
  );
}

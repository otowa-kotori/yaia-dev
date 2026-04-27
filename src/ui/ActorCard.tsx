// Reusable actor card — name, HP bar, optional ATB gauge.
//
// The ATB gauge is a subtle, low-key progress indicator that shows how close
// an actor is to their next action. It uses **charge-up (前摇) semantics**:
// the bar always goes 0→full, full = about to act, then snaps back to 0
// (or negative, which clamps to 0). No percentage label — just a vibe.
//
// The card comes in two visual flavors controlled by `variant`:
//   "hero"  — full-size with room for children (XP bar, etc.)
//   "enemy" — compact: name + HP inline, smaller text

import type { Character } from "../core/entity/actor";
import { getAttr } from "../core/entity/actor";
import { ATTR } from "../core/entity/attribute";
import { T } from "./text";


export interface ActorCardProps {
  actor: Character;
  /** ATB energy as a fraction in [0, 1] (clamped). Omit to hide the gauge. */
  atbPct?: number;
  /** Visual variant. Default "enemy". */
  variant?: "hero" | "enemy";
  /** Optional extra row rendered below the bars (e.g. XP for heroes). */
  children?: React.ReactNode;
  /** Right-aligned label next to the name. */
  statusLabel?: string;
}

export function ActorCard({
  actor,
  atbPct,
  variant = "enemy",
  children,
  statusLabel,
}: ActorCardProps) {
  const maxHp = Math.max(1, getAttr(actor, ATTR.MAX_HP));
  const maxMp = Math.max(0, getAttr(actor, ATTR.MAX_MP));
  const hpPct = Math.max(0, Math.min(1, actor.currentHp / maxHp));
  const mpPct = maxMp > 0 ? Math.max(0, Math.min(1, actor.currentMp / maxMp)) : 0;
  const showMp = maxMp > 0;
  const dead = actor.currentHp <= 0;
  const isHero = variant === "hero";

  return (
    <div
      style={{
        marginBottom: isHero ? 8 : 4,
        padding: isHero ? 10 : 7,
        background: "#222",
        borderRadius: 4,
        opacity: dead ? 0.35 : 1,
      }}
    >
      {/* Header: name (+ level/status for hero, + HP numbers for enemy) */}
      {isHero ? (
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
          <span style={{ fontWeight: 600 }}>
            {actor.name}
            {dead ? ` (${T.ko})` : ""}
          </span>
          {statusLabel && (
            <span style={{ fontSize: 12, opacity: 0.7 }}>{statusLabel}</span>
          )}
        </div>
      ) : (
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontWeight: 500, fontSize: 13 }}>
            {actor.name}
            {dead ? ` (${T.ko})` : ""}
          </span>
          <span style={{ fontSize: 11, opacity: 0.6, fontVariantNumeric: "tabular-nums" }}>
            {Math.round(actor.currentHp)}/{Math.round(maxHp)}
          </span>
        </div>
      )}

      {/* HP bar */}
      <div style={{ marginTop: isHero ? 0 : 3 }}>
        <Bar pct={hpPct} color={isHero ? "#4a7" : "#c44"} height={isHero ? 6 : 4} />
        {isHero && (
          <div style={barLabel}>
            HP {Math.round(actor.currentHp)} / {Math.round(maxHp)}
          </div>
        )}
      </div>

      {/* MP bar */}
      {showMp && (
        <div style={{ marginTop: isHero ? 3 : 2 }}>
          <Bar pct={mpPct} color={isHero ? "#58a6ff" : "#4d7fe0"} height={isHero ? 6 : 4} />
          {isHero && (
            <div style={barLabel}>
              MP {Math.round(actor.currentMp)} / {Math.round(maxMp)}
            </div>
          )}
        </div>
      )}

      {/* ATB gauge — subtle, no label */}
      {atbPct !== undefined && !dead && (
        <div style={{ marginTop: isHero ? 3 : 2 }}>
          <Bar
            pct={Math.min(1, Math.max(0, atbPct))}
            color="#666"
            height={3}
            bg="#333"
          />
        </div>
      )}

      {children}
    </div>
  );
}

// ---------- Internal ----------

function Bar({
  pct,
  color,
  height = 6,
  bg = "#111",
}: {
  pct: number;
  color: string;
  height?: number;
  bg?: string;
}) {
  return (
    <div style={{ height, background: bg, borderRadius: 2, overflow: "hidden" }}>
      <div
        style={{
          height: "100%",
          width: `${Math.min(1, Math.max(0, pct)) * 100}%`,
          background: color,
          transition: "width 100ms linear",
        }}
      />
    </div>
  );
}

const barLabel: React.CSSProperties = {
  fontSize: 11,
  marginTop: 2,
  opacity: 0.7,
  fontVariantNumeric: "tabular-nums",
};

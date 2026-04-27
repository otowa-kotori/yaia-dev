// Reusable actor card — name, HP bar, optional MP/ATB gauge.
//
// Two visual flavours controlled by `variant`:
//   "hero"  — full-size with room for children (XP bar, etc.)
//   "enemy" — compact, red-accented border

import type { ReactNode } from "react";
import type { Character } from "../../core/entity/actor";
import { getAttr } from "../../core/entity/actor";
import { ATTR } from "../../core/entity/attribute";
import { T } from "../text";
import { Card } from "./Card";
import { ProgressBar } from "./ProgressBar";

export interface ActorCardProps {
  actor: Character;
  /** ATB energy as a fraction in [0, 1] (clamped). Omit to hide the gauge. */
  atbPct?: number;
  /** Visual variant. Default "enemy". */
  variant?: "hero" | "enemy";
  /** Optional extra row rendered below the bars (e.g. XP for heroes). */
  children?: ReactNode;
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
  const hpPct = actor.currentHp / maxHp;
  const showMp = maxMp > 0;
  const dead = actor.currentHp <= 0;
  const isHero = variant === "hero";

  return (
    <Card
      variant={isHero ? "default" : "enemy"}
      className={`${isHero ? "p-3" : "p-2"} ${dead ? "opacity-35" : ""}`}
    >
      {/* ---- Header ---- */}
      {isHero ? (
        <div className="flex items-center justify-between mb-2">
          <span className="font-semibold text-white">
            {actor.name}
            {dead ? ` (${T.ko})` : ""}
          </span>
          {statusLabel && (
            <span className="text-[11px] text-gray-500">{statusLabel}</span>
          )}
        </div>
      ) : (
        <div className="flex items-center justify-between mb-1.5">
          <span className="font-medium text-[13px] text-enemy">
            {actor.name}
            {dead ? ` (${T.ko})` : ""}
          </span>
          <span className="text-[11px] text-gray-500 tabular-nums">
            {Math.round(actor.currentHp)}/{Math.round(maxHp)}
          </span>
        </div>
      )}

      {/* ---- HP ---- */}
      <ProgressBar
        value={actor.currentHp}
        max={maxHp}
        color="hp"
        size={isHero ? "md" : "sm"}
        label={isHero ? "HP" : undefined}
        valueLabel={isHero ? `${Math.round(actor.currentHp)} / ${Math.round(maxHp)}` : undefined}
      />

      {/* ---- MP ---- */}
      {showMp && (
        <div className="mt-1.5">
          <ProgressBar
            value={actor.currentMp}
            max={maxMp}
            color="mp"
            size={isHero ? "md" : "sm"}
            label={isHero ? "MP" : undefined}
            valueLabel={isHero ? `${Math.round(actor.currentMp)} / ${Math.round(maxMp)}` : undefined}
          />
        </div>
      )}

      {/* ---- ATB ---- */}
      {atbPct !== undefined && !dead && (
        <div className="mt-1.5">
          <ProgressBar
            value={atbPct}
            max={1}
            color="atb"
            size="sm"
            label={isHero ? "ATB" : undefined}
            valueLabel={isHero ? `${Math.round(Math.min(1, Math.max(0, atbPct)) * 100)}%` : undefined}
          />
        </div>
      )}

      {children}
    </Card>
  );
}

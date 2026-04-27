// ProgressBar — unified bar for HP, MP, XP, ATB.
//
// Colour is picked by a semantic `color` prop; the track background uses
// the matching `*-bg` token from the design system.

export interface ProgressBarProps {
  /** Current value. */
  value: number;
  /** Maximum value. Clamped to >= 1 to avoid division by zero. */
  max: number;
  /** Semantic colour — maps to the design-token pair. */
  color: "hp" | "mp" | "xp" | "atb";
  /** Height variant. Default "md". */
  size?: "sm" | "md";
  /** Optional left label (e.g. "HP"). */
  label?: string;
  /** Optional right label (e.g. "186 / 220"). */
  valueLabel?: string;
}

const BAR_COLORS: Record<ProgressBarProps["color"], { bar: string; bg: string }> = {
  hp:  { bar: "bg-hp",  bg: "bg-hp-bg"  },
  mp:  { bar: "bg-mp",  bg: "bg-mp-bg"  },
  xp:  { bar: "bg-xp",  bg: "bg-xp-bg"  },
  atb: { bar: "bg-atb", bg: "bg-atb-bg" },
};

const LABEL_COLORS: Record<ProgressBarProps["color"], string> = {
  hp:  "text-hp",
  mp:  "text-mp",
  xp:  "text-xp",
  atb: "text-atb",
};

const SIZE: Record<NonNullable<ProgressBarProps["size"]>, string> = {
  sm: "h-1.5",
  md: "h-2",
};

export function ProgressBar({
  value,
  max,
  color,
  size = "md",
  label,
  valueLabel,
}: ProgressBarProps) {
  const safeMax = Math.max(1, max);
  const pct = Math.max(0, Math.min(1, value / safeMax)) * 100;
  const { bar, bg } = BAR_COLORS[color];

  return (
    <div>
      {(label || valueLabel) && (
        <div className="flex justify-between text-[11px] mb-0.5 tabular-nums">
          {label && <span className={LABEL_COLORS[color]}>{label}</span>}
          {valueLabel && <span className="text-gray-400">{valueLabel}</span>}
        </div>
      )}
      <div className={`${bg} rounded-full overflow-hidden ${SIZE[size]}`}>
        <div
          className={`h-full ${bar} rounded-full transition-[width] duration-100 ease-linear`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

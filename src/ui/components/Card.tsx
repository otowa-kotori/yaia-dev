// Card — reusable rounded card container.
//
// Wraps content in a consistent dark rounded-corner card with border.
// `variant` controls the border accent:
//   "default" — standard border
//   "enemy"   — faint red border
//   "active"  — accent green border

import type { ReactNode } from "react";

export interface CardProps {
  children: ReactNode;
  className?: string;
  variant?: "default" | "enemy" | "active";
}

const variantClass: Record<NonNullable<CardProps["variant"]>, string> = {
  default: "border-border",
  enemy:   "border-enemy-border",
  active:  "border-accent/40",
};

export function Card({ children, className = "", variant = "default" }: CardProps) {
  return (
    <div className={`bg-surface rounded-lg border ${variantClass[variant]} ${className}`}>
      {children}
    </div>
  );
}

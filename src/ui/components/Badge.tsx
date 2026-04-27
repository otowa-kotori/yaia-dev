// Badge — small status / category pill.

import type { ReactNode } from "react";

export interface BadgeProps {
  children: ReactNode;
  variant?: "accent" | "warning" | "danger" | "neutral" | "info";
  className?: string;
}

const variantClass: Record<NonNullable<BadgeProps["variant"]>, string> = {
  accent:  "bg-accent/20 text-accent border-accent/30",
  warning: "bg-yellow-900/30 text-yellow-300 border-yellow-700/40",
  danger:  "bg-red-900/30 text-red-400 border-red-700/40",
  neutral: "bg-surface-lighter text-gray-400 border-border",
  info:    "bg-blue-900/30 text-blue-400 border-blue-700/40",
};

export function Badge({ children, variant = "neutral", className = "" }: BadgeProps) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium border ${variantClass[variant]} ${className}`}>
      {children}
    </span>
  );
}

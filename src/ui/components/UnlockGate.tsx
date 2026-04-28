import type { ReactNode } from "react";
import type { GameStore } from "../store";
import { useUnlock } from "../hooks/useUnlock";
import { T, fmt } from "../text";

interface UnlockGateProps {
  store: GameStore;
  unlockId: string;
  children: ReactNode;
  fallback?: ReactNode;
  compact?: boolean;
}

export function UnlockGate({ store, unlockId, children, fallback, compact = false }: UnlockGateProps) {
  const unlocked = useUnlock(store, unlockId);
  if (unlocked) return <>{children}</>;
  if (fallback) return <>{fallback}</>;
  if (compact) {
    return (
      <div className="text-xs text-gray-500">
        {fmt(T.unlockGateLockedInline, { unlockId })}
      </div>
    );
  }
  return (
    <div className="rounded border border-border bg-surface px-3 py-2 text-sm text-gray-400">
      {fmt(T.unlockGateLocked, { unlockId })}
    </div>
  );
}

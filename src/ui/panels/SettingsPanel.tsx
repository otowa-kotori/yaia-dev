// Settings panel — speed controls, build info, and danger zone.
//
// Extracted from App.tsx SettingsTab. Provides:
//   - Build info card (release channel, version, save namespace, commit SHA)
//   - Speed multiplier selector (0x / 1x / 2x / 5x)
//   - Danger zone with clear save button

import {
  APP_VERSION,
  BUILD_SHA,
  RELEASE_CHANNEL,
  SAVE_NAMESPACE,
} from "../../env";
import type { GameStore } from "../store";
import { useStore } from "../hooks/useStore";
import { T } from "../text";
import { Card } from "../components/Card";

const RELEASE_CHANNEL_LABEL = RELEASE_CHANNEL === "dev" ? T.releaseChannelDev : T.releaseChannelStable;

export function SettingsPanel({ store }: { store: GameStore }) {
  const { store: s } = useStore(store);
  const speed = s.getSpeedMultiplier();

  return (
    <div className="flex flex-col gap-4">
      {/* Build info */}
      <Card className="p-2.5">
        <div className="text-[11px] opacity-50 tracking-wide uppercase mb-2">
          {T.buildInfo}
        </div>
        <div className="grid gap-1 text-[13px]">
          <div>
            <span className="opacity-60">{T.releaseChannelLabel}</span>
            {RELEASE_CHANNEL_LABEL}
          </div>
          <div>
            <span className="opacity-60">{T.versionLabel}</span>
            {APP_VERSION}
          </div>
          <div>
            <span className="opacity-60">{T.saveNamespaceLabel}</span>
            <code className="text-xs">{SAVE_NAMESPACE}</code>
          </div>
          <div>
            <span className="opacity-60">{T.buildCommitLabel}</span>
            <code className="text-xs">{BUILD_SHA}</code>
          </div>
        </div>
      </Card>

      {/* Speed */}
      <Card className="p-2.5">
        <div className="text-[11px] opacity-50 tracking-wide uppercase mb-2">
          {T.speed}
        </div>
        <div className="flex gap-2 flex-wrap">
          {[0, 1, 2, 5].map((m) => (
            <button
              key={m}
              onClick={() => s.setSpeedMultiplier(m)}
              className={`px-2.5 py-1 text-xs rounded border font-[inherit] ${
                speed === m
                  ? "border-emerald-600 bg-emerald-700 text-white cursor-default"
                  : "border-gray-700 bg-[#2a2a2a] text-white cursor-pointer hover:bg-[#333]"
              }`}
            >
              {m === 0 ? T.pause : `${m}x`}
            </button>
          ))}
        </div>
      </Card>

      {/* Danger zone */}
      <Card className="p-2.5">
        <div className="text-[11px] opacity-50 tracking-wide uppercase mb-2">
          {T.dangerZone}
        </div>
        <button
          onClick={() => {
            if (confirm(T.confirmClearSave)) {
              void s.clearSaveAndReset();
            }
          }}
          className="px-2.5 py-1 text-xs rounded border border-red-800 bg-[#2a2a2a] text-red-400 cursor-pointer hover:bg-red-950/40 font-[inherit]"
        >
          {T.btn_clearSave}
        </button>
      </Card>
    </div>
  );
}

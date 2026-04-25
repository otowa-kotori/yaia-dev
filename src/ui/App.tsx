// App shell — multi-tab layout with character bar.
//
// Tabs:
//   0: 地图 & 战斗  — StageSelector + Controls + BattleView
//   1: 背包         — InventoryView（含装备面板）
//   2: 合成         — CraftingView（配方与制作）
//   3: 经验总览      — XpOverview (level / attrs / skills)
//   4: 全局升级      — UpgradesView
//   5: 设置         — speed selector + clear save
//
// CharacterBar sits between the title and tabs, showing all heroes with
// their current activity status. Clicking a hero switches focusedCharId.
//
// Tab state is purely local to this component; it does not touch core or
// the store. The store is created once (useMemo), shared to all children.

import { useEffect, useMemo, useState } from "react";
import { buildDefaultContent } from "../content";
import { getContent } from "../core/content";
import { createGameStore, type GameStore } from "./store";
import { BattleView } from "./BattleView";
import { InventoryView } from "./InventoryView";
import { CraftingView } from "./CraftingView";
import { XpOverview } from "./XpOverview";
import { UpgradesView } from "./UpgradesView";
import { TalentsView } from "./TalentsView";
import { ActivityLogPanel } from "./ActivityLogPanel";
import { useStore } from "./useStore";
import { T, fmt } from "./text";
import {
  CharacterSelectButtons,
  getCharacterSelectStatusLabel,
} from "./CharacterSelectButtons";
import { PartyDialog, type PartyDialogMode } from "./PartyDialog";

// ---------- Container ----------

const containerStyle: React.CSSProperties = {
  fontFamily: "system-ui, sans-serif",
  maxWidth: 720,
  margin: "40px auto",
  padding: 16,
  color: "#ddd",
  background: "#1a1a1a",
  borderRadius: 8,
  minHeight: "60vh",
};

// ---------- Tab definitions ----------

type TabId = "map" | "log" | "inventory" | "crafting" | "xp" | "talents" | "upgrades" | "settings";

const TABS: Array<{ id: TabId; label: string }> = [
  { id: "map",       label: T.tab_map },
  { id: "log",       label: T.tab_log },
  { id: "inventory", label: T.tab_inventory },
  { id: "crafting",  label: T.tab_crafting },
  { id: "xp",        label: T.tab_xp },
  { id: "talents",   label: T.tab_talents },
  { id: "upgrades",  label: T.tab_upgrades },
  { id: "settings",  label: T.tab_settings },
];

// ---------- App ----------

export function App() {
  const store = useMemo(() => createGameStore({ content: DEFAULT_CONTENT }), []);
  const [activeTab, setActiveTab] = useState<TabId>("map");

  return (
    <div style={containerStyle}>
      <h1 style={{ margin: "0 0 12px", fontSize: 20, color: "#fff" }}>
        YAIA
      </h1>
      <CatchUpOverlay store={store} />
      <CharacterBar store={store} />
      <TabBar activeTab={activeTab} onSelect={setActiveTab} />
      <TabPanel activeTab={activeTab} store={store} />
    </div>
  );
}

// ---------- Catch-up overlay (global) ----------

/** Full-width progress banner shown during any catch-up (real or debug).
 *  Listens to bus events so it works identically for cold-resume,
 *  visibilitychange, and debug simulation. */
function CatchUpOverlay({ store }: { store: GameStore }) {
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [result, setResult] = useState<string | null>(null);

  useEffect(() => {
    const offProgress = store.bus.on("catchUpProgress", (p) => {
      setProgress({ done: p.done, total: p.total });
      setResult(null);
    });
    const offApplied = store.bus.on("catchUpApplied", (e) => {
      setProgress(null);
      if (e.appliedTicks > 0) {
        if (e.cancelled) {
          setResult(fmt(T.catchUpCancelled, { ticks: e.appliedTicks }));
        } else {
          setResult(fmt(T.catchUpDone, { ticks: e.appliedTicks }));
        }
        // Auto-dismiss after a few seconds
        const timer = setTimeout(() => setResult(null), 4000);
        return () => clearTimeout(timer);
      }
    });
    return () => { offProgress(); offApplied(); };
  }, [store.bus]);

  if (!progress && !result) return null;

  const pct = progress ? progress.done / progress.total : 1;

  return (
    <div style={{
      background: "#1a2a3a",
      borderRadius: 6,
      padding: "8px 12px",
      marginBottom: 12,
      border: "1px solid #2a4a6a",
    }}>
      {progress && (
        <>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 4 }}>
            <span style={{ color: "#8cf" }}>{T.catchUpInProgress}</span>
            <span style={{ fontVariantNumeric: "tabular-nums", opacity: 0.7 }}>
              {fmt(T.catchUpProgressLabel, { done: progress.done, total: progress.total })}
              {" · "}{Math.round(pct * 100)}%
            </span>
          </div>
          <div style={{ height: 6, background: "#111", borderRadius: 3, overflow: "hidden" }}>
            <div style={{
              height: "100%",
              width: `${pct * 100}%`,
              background: "#59c",
              transition: "width 80ms linear",
            }} />
          </div>
          <div style={{ marginTop: 4, display: "flex", justifyContent: "flex-end" }}>
            <button
              onClick={() => store.cancelCatchUp()}
              style={{
                padding: "2px 8px", fontSize: 11, borderRadius: 3,
                border: "1px solid #644", background: "transparent",
                color: "#f88", cursor: "pointer", fontFamily: "inherit",
              }}
            >
              {T.catchUpCancel}
            </button>
          </div>
        </>
      )}
      {!progress && result && (
        <div style={{ fontSize: 12, color: "#6d9" }}>{result}</div>
      )}
    </div>
  );
}

// ---------- CharacterBar ----------

function CharacterBar({ store }: { store: GameStore }) {
  const { store: s } = useStore(store);
  const heroes = s.listHeroes();
  const focusedId = s.focusedCharId;

  if (heroes.length <= 1) return null;

  const options = heroes.map((hero) => {
    const cc = s.getCharacter(hero.id);
    return {
      id: hero.id,
      name: hero.name,
      level: hero.level,
      statusLabel: getCharacterSelectStatusLabel(hero, cc.activity),
    };
  });

  return (
    <div style={{ marginBottom: 12 }}>
      <CharacterSelectButtons
        options={options}
        selectedIds={[focusedId]}
        mode="single"
        onChange={(nextSelectedIds) => {
          const nextId = nextSelectedIds[0];
          if (nextId) s.setFocusedChar(nextId);
        }}
      />
    </div>
  );
}

// ---------- TabBar ----------

function TabBar({
  activeTab,
  onSelect,
}: {
  activeTab: TabId;
  onSelect: (id: TabId) => void;
}) {
  return (
    <div
      style={{
        display: "flex",
        gap: 2,
        borderBottom: "1px solid #333",
        marginBottom: 16,
      }}
    >
      {TABS.map((t) => {
        const active = t.id === activeTab;
        return (
          <button
            key={t.id}
            onClick={() => onSelect(t.id)}
            style={{
              padding: "7px 14px",
              fontSize: 13,
              border: "none",
              borderBottom: active ? "2px solid #4a9" : "2px solid transparent",
              background: "transparent",
              color: active ? "#fff" : "#999",
              cursor: active ? "default" : "pointer",
              fontFamily: "inherit",
              marginBottom: -1, // overlap the container border-bottom
              transition: "color 100ms",
            }}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}

// ---------- TabPanel ----------

function TabPanel({
  activeTab,
  store,
}: {
  activeTab: TabId;
  store: GameStore;
}) {
  switch (activeTab) {
    case "map":
      return <MapTab store={store} />;
    case "log":
      return <LogTab store={store} />;
    case "inventory":
      return <InventoryView store={store} />;
    case "crafting":
      return <CraftingView store={store} />;
    case "xp":
      return <XpOverview store={store} />;
    case "talents":
      return <TalentsView store={store} />;
    case "talents":
      return <TalentsView store={store} />;
    case "upgrades":
      return <UpgradesView store={store} />;
    case "settings":
      return <SettingsTab store={store} />;
  }
}

// ---------- Map & Combat tab ----------

function MapTab({ store }: { store: GameStore }) {
  return (
    <div>
      <LocationSelector store={store} />
      <Controls store={store} />
      <BattleView store={store} />
    </div>
  );
}

function LogTab({ store }: { store: GameStore }) {
  const { store: s } = useStore(store);
  return (
    <div style={{ background: "#222", borderRadius: 6, padding: 12, border: "1px solid #333" }}>
      <div style={{ fontSize: 11, opacity: 0.6, textTransform: "uppercase", letterSpacing: 0.4 }}>
        {T.gameLogTitle}
      </div>
      <ActivityLogPanel
        entries={s.state.gameLog}
        emptyMessage={T.gameLogEmpty}
        limit={40}
      />
    </div>
  );
}

function LocationSelector({ store }: { store: GameStore }) {
  const { store: s } = useStore(store);
  const cc = s.getFocusedCharacter();
  const locationIds = s.listLocationIds();
  const currentLocationId = cc.hero.locationId;
  const content = getContent();
  const stage = cc.stageSession;

  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
        <span style={{ fontSize: 12, opacity: 0.6, alignSelf: "center" }}>{T.label_location}</span>
        {locationIds.map((id) => (
          <button
            key={id}
            onClick={() => {
              const pending = cc.stageSession?.pendingLoot ?? [];
              if (pending.length > 0) {
                if (!confirm(T.confirmLeavePendingLoot)) return;
              }
              cc.enterLocation(id);
            }}
            style={btnStyle(currentLocationId === id, true)}
            title={id}
          >
            {content.locations[id]?.name ?? id}
          </button>
        ))}
      </div>
      {currentLocationId && !stage && (
        <EntryList locationId={currentLocationId} store={store} />
      )}
    </div>
  );
}

function EntryList({
  locationId,
  store,
}: {
  locationId: string;
  store: GameStore;
}) {
  const { store: s } = useStore(store);
  const cc = s.getFocusedCharacter();
  const content = getContent();
  const [pendingEntry, setPendingEntry] = useState<{
    mode: PartyDialogMode;
    targetId: string;
  } | null>(null);
  const loc = content.locations[locationId];
  if (!loc) return null;

  return (
    <>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginLeft: 4 }}>
        {loc.entries.map((entry, i) => {
          const label = entry.label ?? (entry.kind === "combat" ? T.entry_combat : T.entry_gather);
          return (
            <button
              key={i}
              onClick={() => {
                if (entry.kind === "combat") {
                  setPendingEntry({ mode: "combat", targetId: entry.combatZoneId });
                } else if (entry.kind === "gather") {
                  const nodeId = entry.resourceNodes[0];
                  if (nodeId) cc.startGather(nodeId);
                } else if (entry.kind === "dungeon") {
                  setPendingEntry({ mode: "dungeon", targetId: entry.dungeonId });
                }
              }}
              style={btnStyle(false, true)}
            >
              {label}
            </button>
          );
        })}
      </div>
      <PartyDialog
        store={store}
        mode={pendingEntry?.mode ?? "combat"}
        targetId={pendingEntry?.targetId ?? null}
        isOpen={pendingEntry !== null}
        onClose={() => setPendingEntry(null)}
        onConfirm={(partyCharIds) => {
          if (!pendingEntry) return;
          if (pendingEntry.mode === "dungeon") {
            s.startDungeon(pendingEntry.targetId, partyCharIds);
          } else {
            s.startPartyCombat(pendingEntry.targetId, partyCharIds);
          }
          setPendingEntry(null);
        }}
      />
    </>
  );
}

function Controls({ store }: { store: GameStore }) {
  const { store: s } = useStore(store);
  const cc = s.getFocusedCharacter();
  const running = cc.isRunning();

  if (!running) return null;

  return (
    <div
      style={{
        display: "flex",
        gap: 8,
        alignItems: "center",
        marginBottom: 16,
        flexWrap: "wrap",
      }}
    >
      <button onClick={() => cc.stopActivity()} style={btnStyle(false)}>
        {T.btn_stop}
      </button>
    </div>
  );
}

// ---------- Settings tab ----------

function SettingsTab({ store }: { store: GameStore }) {
  const { store: s } = useStore(store);
  const speed = s.getSpeedMultiplier();

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Speed */}
      <div style={{ background: "#222", borderRadius: 4, padding: 10 }}>
        <div style={{ fontSize: 11, opacity: 0.5, letterSpacing: 0.5, textTransform: "uppercase", marginBottom: 8 }}>
          {T.speed}
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {[0, 1, 2, 5].map((m) => (
            <button
              key={m}
              onClick={() => s.setSpeedMultiplier(m)}
              style={btnStyle(speed === m, true)}
            >
              {m === 0 ? T.pause : `${m}x`}
            </button>
          ))}
        </div>
      </div>

      {/* Danger zone */}
      <div style={{ background: "#222", borderRadius: 4, padding: 10 }}>
        <div style={{ fontSize: 11, opacity: 0.5, letterSpacing: 0.5, textTransform: "uppercase", marginBottom: 8 }}>
          {T.dangerZone}
        </div>
        <button
          onClick={() => {
            if (confirm(T.confirmClearSave)) {
              void s.clearSaveAndReset();
            }
          }}
          style={{ ...btnStyle(false, true), borderColor: "#733", color: "#f88" }}
        >
          {T.btn_clearSave}
        </button>
      </div>

      {/* Debug panel — only in development */}
      {import.meta.env.DEV && <DebugPanel store={store} />}
    </div>
  );
}

// ---------- Debug: active effects on any actor ----------

import { isCharacter } from "../core/entity/actor/types";
import type { Character } from "../core/entity/actor/types";

function DebugActiveEffects({ store }: { store: GameStore }) {
  const { store: s } = useStore(store);
  const [selectedId, setSelectedId] = useState<string>("");

  const state = s.state;
  const characters = state.actors.filter(isCharacter) as Character[];
  if (characters.length === 0) return null;

  // Default to focused hero if nothing selected.
  const focusedId = s.getFocusedCharacter()?.hero?.id ?? "";
  const actorId = selectedId || focusedId || characters[0]?.id || "";
  const actor = characters.find(c => c.id === actorId);

  return (
    <div style={{ marginBottom: 8 }}>
      {/* Actor selector */}
      <div style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 4 }}>
        <span style={{ fontSize: 11, opacity: 0.5 }}>ActiveEffects</span>
        <select
          value={actorId}
          onChange={e => setSelectedId(e.target.value)}
          style={{
            fontSize: 10, background: "#111", color: "#ccc", border: "1px solid #444",
            borderRadius: 3, padding: "1px 4px", fontFamily: "inherit",
          }}
        >
          {characters.map(c => (
            <option key={c.id} value={c.id}>
              {c.name} ({c.id}) HP:{c.currentHp}
            </option>
          ))}
        </select>
      </div>

      {!actor ? (
        <div style={{ fontSize: 10, opacity: 0.3 }}>No actor selected</div>
      ) : actor.activeEffects.length === 0 ? (
        <div style={{ fontSize: 10, opacity: 0.3 }}>(none)</div>
      ) : (
        <div style={{ fontSize: 10, opacity: 0.7, display: "flex", flexDirection: "column", gap: 3 }}>
          {actor.activeEffects.map((ae, i) => (
            <div key={i} style={{ background: "#181828", borderRadius: 3, padding: "3px 6px" }}>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <span style={{ color: ae.remainingActions === -1 ? "#9b9" : "#cc9", fontWeight: 600 }}>
                  {ae.effectId}
                </span>
                <span style={{ opacity: 0.4 }}>
                  {ae.remainingActions === -1 ? "∞" : `${ae.remainingActions}act`}
                </span>
                {ae.sourceTalentId && (
                  <span style={{ opacity: 0.3 }}>← {ae.sourceTalentId}</span>
                )}
                {ae.stacks > 1 && (
                  <span style={{ opacity: 0.4 }}>×{ae.stacks}</span>
                )}
              </div>
              {Object.keys(ae.state).length > 0 && (
                <pre style={{ margin: "2px 0 0", fontSize: 9, opacity: 0.4, whiteSpace: "pre-wrap" }}>
                  {JSON.stringify(ae.state)}
                </pre>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------- Debug panel ----------

function DebugPanel({ store }: { store: GameStore }) {
  const { store: s } = useStore(store);
  const [hours, setHours] = useState("1");

  const state = s.state;
  const wallClockStr = state.lastWallClockMs
    ? new Date(state.lastWallClockMs).toLocaleString()
    : "—";

  return (
    <div style={{ background: "#1e1e2e", borderRadius: 4, padding: 10, border: "1px dashed #555" }}>
      <div style={{ fontSize: 11, opacity: 0.5, letterSpacing: 0.5, textTransform: "uppercase", marginBottom: 4 }}>
        {T.debugTools}
      </div>
      <div style={{ fontSize: 10, opacity: 0.35, marginBottom: 10 }}>
        {T.debugOnlyInDev}
      </div>

      {/* State snapshot */}
      <div style={{ fontSize: 12, opacity: 0.7, marginBottom: 10, display: "grid", gridTemplateColumns: "auto 1fr", gap: "2px 12px" }}>
        <span>{T.debugTick}</span>
        <span style={{ fontVariantNumeric: "tabular-nums" }}>{state.tick}</span>
        <span>{T.debugWallClock}</span>
        <span>{wallClockStr}</span>
        <span>{T.debugActors}</span>
        <span>{state.actors.length}</span>
        <span>{T.debugSpeed}</span>
        <span>{s.getSpeedMultiplier()}x</span>
      </div>

      {/* Active effects on focused hero */}
      <DebugActiveEffects store={store} />

      {/* Catch-up simulator — triggers the same pipeline as real catch-up */}
      <div style={{ fontSize: 11, opacity: 0.5, marginBottom: 4 }}>
        {T.debugCatchUp}
      </div>
      <div style={{ fontSize: 10, opacity: 0.35, marginBottom: 6 }}>
        {T.debugCatchUpHint}
      </div>
      <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
        <input
          type="number"
          min="0.1"
          step="0.5"
          value={hours}
          onChange={(e) => setHours(e.target.value)}
          style={{
            width: 60, padding: "3px 6px", fontSize: 12,
            background: "#111", border: "1px solid #444", borderRadius: 3,
            color: "#fff", fontFamily: "inherit",
          }}
        />
        <span style={{ fontSize: 11, opacity: 0.5 }}>{T.debugCatchUpHours}</span>
        <button
          onClick={() => {
            const h = parseFloat(hours);
            if (Number.isFinite(h) && h > 0) s.debugSimulateCatchUp(h);
          }}
          style={{ ...btnStyle(false, true), borderColor: "#669" }}
        >
          {T.debugCatchUpRun}
        </button>
      </div>
    </div>
  );
}

// ---------- Shared helpers ----------

function btnStyle(active: boolean, small = false): React.CSSProperties {
  return {
    padding: small ? "4px 10px" : "6px 14px",
    fontSize: small ? 12 : 14,
    borderRadius: 4,
    border: "1px solid #444",
    background: active ? "#2a5" : "#2a2a2a",
    color: "#fff",
    cursor: active ? "default" : "pointer",
    opacity: active && !small ? 0.6 : 1,
    fontFamily: "inherit",
  };
}

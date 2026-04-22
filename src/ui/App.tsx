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

import { useMemo, useState } from "react";
import { buildDefaultContent } from "../content";
import { getContent } from "../core/content";
import { createGameStore, type GameStore } from "./store";
import { BattleView } from "./BattleView";
import { InventoryView } from "./InventoryView";
import { CraftingView } from "./CraftingView";
import { XpOverview } from "./XpOverview";
import { UpgradesView } from "./UpgradesView";
import { useStore } from "./useStore";
import { ACTIVITY_COMBAT_KIND, ACTIVITY_GATHER_KIND } from "../core/activity";
import { T } from "./text";

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

type TabId = "map" | "inventory" | "crafting" | "xp" | "upgrades" | "settings";

const TABS: Array<{ id: TabId; label: string }> = [
  { id: "map",       label: T.tab_map },
  { id: "inventory", label: T.tab_inventory },
  { id: "crafting",  label: T.tab_crafting },
  { id: "xp",        label: T.tab_xp },
  { id: "upgrades",  label: T.tab_upgrades },
  { id: "settings",  label: T.tab_settings },
];

// ---------- App ----------

export function App() {
  const store = useMemo(() => createGameStore({ content: buildDefaultContent() }), []);
  const [activeTab, setActiveTab] = useState<TabId>("map");

  return (
    <div style={containerStyle}>
      <h1 style={{ margin: "0 0 12px", fontSize: 20, color: "#fff" }}>
        YAIA
      </h1>
      <CharacterBar store={store} />
      <TabBar activeTab={activeTab} onSelect={setActiveTab} />
      <TabPanel activeTab={activeTab} store={store} />
    </div>
  );
}

// ---------- CharacterBar ----------

function CharacterBar({ store }: { store: GameStore }) {
  const { store: s } = useStore(store);
  const heroes = s.listHeroes();
  const focusedId = s.focusedCharId;

  if (heroes.length <= 1) return null;

  return (
    <div
      style={{
        display: "flex",
        gap: 6,
        marginBottom: 12,
        flexWrap: "wrap",
      }}
    >
      {heroes.map((hero) => {
        const active = hero.id === focusedId;
        const cc = s.getCharacter(hero.id);
        let statusLabel: string = T.status_idle;
        if (cc.activity?.kind === ACTIVITY_COMBAT_KIND) {
          statusLabel = T.status_inCombat;
        } else if (cc.activity?.kind === ACTIVITY_GATHER_KIND) {
          statusLabel = T.status_gathering;
        } else if (hero.locationId) {
          statusLabel = T.status_idle;
        }
        return (
          <button
            key={hero.id}
            onClick={() => s.setFocusedChar(hero.id)}
            style={{
              padding: "6px 12px",
              fontSize: 12,
              borderRadius: 6,
              border: active ? "2px solid #4a9" : "1px solid #444",
              background: active ? "#2a3a2a" : "#222",
              color: active ? "#fff" : "#aaa",
              cursor: active ? "default" : "pointer",
              fontFamily: "inherit",
              display: "flex",
              flexDirection: "column",
              alignItems: "flex-start",
              gap: 2,
              minWidth: 90,
            }}
          >
            <span style={{ fontWeight: 600 }}>{hero.name}</span>
            <span style={{ fontSize: 10, opacity: 0.65 }}>
              Lv {hero.level} · {statusLabel}
            </span>
          </button>
        );
      })}
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
    case "inventory":
      return <InventoryView store={store} />;
    case "crafting":
      return <CraftingView store={store} />;
    case "xp":
      return <XpOverview store={store} />;
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
            onClick={() => cc.enterLocation(id)}
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
  const loc = content.locations[locationId];
  if (!loc) return null;

  return (
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginLeft: 4 }}>
      {loc.entries.map((entry, i) => {
        const label = entry.label ?? (entry.kind === "combat" ? T.entry_combat : T.entry_gather);
        return (
          <button
            key={i}
            onClick={() => {
              if (entry.kind === "combat") {
                cc.startFight(entry.encounterId);
              } else {
                const nodeId = entry.resourceNodes[0];
                if (nodeId) cc.startGather(nodeId);
              }
            }}
            style={btnStyle(false, true)}
          >
            {label}
          </button>
        );
      })}
    </div>
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

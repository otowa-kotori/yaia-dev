// App shell — multi-tab layout.
//
// Tabs:
//   0: 地图 & 战斗  — StageSelector + Controls + BattleView
//   1: 背包         — InventoryView (grid)
//   2: 经验总览      — XpOverview (level / attrs / skills)
//   3: 设置         — speed selector + clear save
//
// Tab state is purely local to this component; it does not touch core or
// the store. The store is created once (useMemo), shared to all children.

import { useMemo, useState } from "react";
import { buildDefaultContent } from "../content";
import { createGameStore } from "./store";
import { BattleView } from "./BattleView";
import { InventoryView } from "./InventoryView";
import { XpOverview } from "./XpOverview";
import { useStore } from "./useStore";

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

type TabId = "map" | "inventory" | "xp" | "settings";

const TABS: Array<{ id: TabId; label: string }> = [
  { id: "map",       label: "地图 & 战斗" },
  { id: "inventory", label: "背包" },
  { id: "xp",        label: "经验总览" },
  { id: "settings",  label: "设置" },
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
      <TabBar activeTab={activeTab} onSelect={setActiveTab} />
      <TabPanel activeTab={activeTab} store={store} />
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
  store: ReturnType<typeof createGameStore>;
}) {
  switch (activeTab) {
    case "map":
      return <MapTab store={store} />;
    case "inventory":
      return <InventoryView store={store} />;
    case "xp":
      return <XpOverview store={store} />;
    case "settings":
      return <SettingsTab store={store} />;
  }
}

// ---------- Map & Combat tab ----------

function MapTab({ store }: { store: ReturnType<typeof createGameStore> }) {
  return (
    <div>
      <StageSelector store={store} />
      <Controls store={store} />
      <BattleView store={store} />
    </div>
  );
}

function StageSelector({ store }: { store: ReturnType<typeof createGameStore> }) {
  const { store: s } = useStore(store);
  const stageIds = s.listStageIds();
  const current = s.stageId;
  return (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
      <span style={{ fontSize: 12, opacity: 0.6, alignSelf: "center" }}>关卡:</span>
      {stageIds.map((id) => (
        <button
          key={id}
          onClick={() => s.enterStage(id)}
          style={btnStyle(current === id, true)}
        >
          {id}
        </button>
      ))}
    </div>
  );
}

function Controls({ store }: { store: ReturnType<typeof createGameStore> }) {
  const { store: s } = useStore(store);
  const running = s.isRunning();
  const hasStage = s.stageId !== null;

  // List resource node actor ids currently in this stage so the user can
  // pick one to gather.
  const stage = s.state.currentStage;
  const nodeIds = stage
    ? stage.spawnedActorIds.filter((id) => {
        const a = s.state.actors.find((x) => x.id === id);
        return a?.kind === "resource_node";
      })
    : [];

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
      {!running ? (
        <>
          <button
            onClick={() => s.startFight()}
            disabled={!hasStage}
            style={btnStyle(false)}
          >
            战斗
          </button>
          {nodeIds.map((id) => (
            <button
              key={id}
              onClick={() => s.startGather(id)}
              style={btnStyle(false)}
            >
              采集 {shortId(id)}
            </button>
          ))}
        </>
      ) : (
        <button onClick={() => s.stopActivity()} style={btnStyle(false)}>
          停止
        </button>
      )}
    </div>
  );
}

// ---------- Settings tab ----------

function SettingsTab({ store }: { store: ReturnType<typeof createGameStore> }) {
  const { store: s } = useStore(store);
  const speed = s.getSpeedMultiplier();

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Speed */}
      <div style={{ background: "#222", borderRadius: 4, padding: 10 }}>
        <div style={{ fontSize: 11, opacity: 0.5, letterSpacing: 0.5, textTransform: "uppercase", marginBottom: 8 }}>
          速度
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {[0, 1, 2, 5].map((m) => (
            <button
              key={m}
              onClick={() => s.setSpeedMultiplier(m)}
              style={btnStyle(speed === m, true)}
            >
              {m === 0 ? "暂停" : `${m}x`}
            </button>
          ))}
        </div>
      </div>

      {/* Danger zone */}
      <div style={{ background: "#222", borderRadius: 4, padding: 10 }}>
        <div style={{ fontSize: 11, opacity: 0.5, letterSpacing: 0.5, textTransform: "uppercase", marginBottom: 8 }}>
          危险区域
        </div>
        <button
          onClick={() => {
            if (confirm("清除存档并重置？此操作不可撤销。")) {
              void s.clearSaveAndReset();
            }
          }}
          style={{ ...btnStyle(false, true), borderColor: "#733", color: "#f88" }}
        >
          清除存档
        </button>
      </div>
    </div>
  );
}

// ---------- Shared helpers ----------

function shortId(id: string): string {
  const parts = id.split(".");
  return parts.slice(-2).join(".");
}

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

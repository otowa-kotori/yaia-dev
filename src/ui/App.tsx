import { useMemo } from "react";
import { buildDefaultContent } from "../content";
import { createGameStore } from "./store";
import { BattleView } from "./BattleView";
import { useStore } from "./useStore";

const containerStyle: React.CSSProperties = {
  fontFamily: "system-ui, sans-serif",
  maxWidth: 680,
  margin: "40px auto",
  padding: 16,
  color: "#ddd",
  background: "#1a1a1a",
  borderRadius: 8,
  minHeight: "60vh",
};

export function App() {
  const store = useMemo(() => createGameStore({ content: buildDefaultContent() }), []);
  const { store: s } = useStore(store);
  return (
    <div style={containerStyle}>
      <h1 style={{ margin: "0 0 16px", fontSize: 20, color: "#fff" }}>
        yaia · combat skeleton
      </h1>
      <Controls store={s} />
      <BattleView store={s} />
    </div>
  );
}

function Controls({ store }: { store: ReturnType<typeof createGameStore> }) {
  const { store: s } = useStore(store);
  const running = s.isRunning();
  const speed = s.getSpeedMultiplier();

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
      <button
        onClick={() => s.startDemoBattle()}
        disabled={running}
        style={btnStyle(running)}
      >
        {running ? "in combat..." : "start battle"}
      </button>
      <span style={{ opacity: 0.6, fontSize: 12 }}>speed:</span>
      {[0, 1, 2, 5].map((m) => (
        <button
          key={m}
          onClick={() => s.setSpeedMultiplier(m)}
          style={btnStyle(speed === m, true)}
        >
          {m === 0 ? "pause" : `${m}x`}
        </button>
      ))}
    </div>
  );
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
  };
}

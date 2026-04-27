// AppShell — root layout component.
//
// Desktop:  Sidebar | TopBar / MainContent | LogSidebar
// Mobile:   TopBar / BattlePanel / Drawer + MobileNav
//
// Key change from previous version:
//   - "battle" tab fills the entire content area (no upper/lower split)
//   - "map" is its own tab for location/entry selection
//   - log only in the right sidebar, not duplicated in BattlePanel

import { useEffect, useState } from "react";
import type { GameStore } from "../store";
import { useStore } from "../hooks/useStore";
import { useBreakpoint } from "../hooks/useBreakpoint";
import { ENABLE_DEBUG_PANEL } from "../../env";
import { T, fmt } from "../text";

import { Sidebar } from "./Sidebar";
import { TopBar } from "./TopBar";
import { MobileNav } from "./MobileNav";
import { Drawer } from "./Drawer";

import { BattlePanel } from "../panels/BattlePanel";
import { MapPanel } from "../panels/MapPanel";
import { ActivityLogPanel } from "../panels/LogPanel";
import { InventoryPanel } from "../panels/InventoryPanel";
import { CraftPanel } from "../panels/CraftPanel";
import { TalentPanel } from "../panels/TalentPanel";
import { StatsPanel } from "../panels/StatsPanel";
import { UpgradePanel } from "../panels/UpgradePanel";
import { SettingsPanel } from "../panels/SettingsPanel";
import { DebugPanel } from "../panels/DebugPanel";

// ── Tab types ──

export type TabId =
  | "battle" | "map" | "inventory" | "craft" | "talents"
  | "stats" | "upgrades" | "settings" | "debug";

// ── Drawer labels for mobile ──

const DRAWER_TITLES: Partial<Record<TabId, string>> = {
  map:       T.tab_map,
  inventory: T.tab_inventory,
  craft:     T.tab_crafting,
  talents:   T.tab_talents,
  stats:     T.tab_xp,
  upgrades:  T.tab_upgrades,
  settings:  T.tab_settings,
  debug:     T.tab_debug,
};

// ── Shell ──

export function AppShell({ store }: { store: GameStore }) {
  const { isDesktop } = useBreakpoint();
  // Desktop uses activeTab for everything.
  // Mobile: main area is always battle; drawer shows the selected secondary tab.
  const [activeTab, setActiveTab] = useState<TabId>("battle");
  const [drawerTab, setDrawerTab] = useState<TabId>("map");
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Close drawer when switching to desktop
  useEffect(() => {
    if (isDesktop) setDrawerOpen(false);
  }, [isDesktop]);

  function handleTabSelect(id: TabId) {
    if (isDesktop) {
      setActiveTab(id);
    } else {
      // Mobile: "battle" closes drawer; anything else opens it with that tab
      if (id === "battle") {
        setDrawerOpen(false);
      } else {
        setDrawerTab(id);
        setDrawerOpen(true);
      }
    }
  }

  // For MobileNav highlight: show "battle" when drawer closed, else drawerTab
  const mobileActiveTab = drawerOpen ? drawerTab : "battle";

  return (
    <div className="h-screen flex flex-col lg:flex-row overflow-hidden bg-[#13131f]">
      {/* ── Desktop Sidebar ── */}
      {isDesktop && (
        <Sidebar
          activeTab={activeTab}
          onSelect={handleTabSelect}
          showDebug={ENABLE_DEBUG_PANEL}
        />
      )}

      {/* ── Main column ── */}
      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        <TopBar store={store} />
        <CatchUpOverlay store={store} />

        <div className="flex-1 flex overflow-hidden min-w-0">
          {/* ── Content area ── */}
          <div className={`flex-1 p-3 lg:p-4 min-w-0 ${isDesktop ? "overflow-y-auto" : "overflow-hidden"}`}>
            {isDesktop
              ? <TabContent tab={activeTab} store={store} />
              : <BattlePanel store={store} />
            }
          </div>

          {/* ── Right: log sidebar (desktop only) ── */}
          {isDesktop && (
            <aside className="w-64 bg-surface border-l border-border flex flex-col shrink-0">
              <div className="p-3 border-b border-border">
                <div className="text-[11px] uppercase tracking-wider text-gray-500">
                  {T.tab_log}
                </div>
              </div>
              <div className="flex-1 overflow-y-auto p-3">
                <LogSidebar store={store} />
              </div>
            </aside>
          )}
        </div>
      </div>

      {/* ── Mobile: Drawer ── */}
      {!isDesktop && (
        <Drawer
          isOpen={drawerOpen}
          title={DRAWER_TITLES[drawerTab] ?? ""}
          onClose={() => setDrawerOpen(false)}
        >
          <div className="p-3">
            <TabContent tab={drawerTab} store={store} />
          </div>
        </Drawer>
      )}

      {/* ── Mobile: Bottom Nav ── */}
      {!isDesktop && (
        <MobileNav activeTab={mobileActiveTab} onSelect={handleTabSelect} />
      )}
    </div>
  );
}

// ── Tab content router ──

function TabContent({ tab, store }: { tab: TabId; store: GameStore }) {
  switch (tab) {
    case "battle":    return <BattlePanel store={store} />;
    case "map":       return <MapPanel store={store} />;
    case "inventory": return <InventoryPanel store={store} />;
    case "craft":     return <CraftPanel store={store} />;
    case "talents":   return <TalentPanel store={store} />;
    case "stats":     return <StatsPanel store={store} />;
    case "upgrades":  return <UpgradePanel store={store} />;
    case "settings":  return <SettingsPanel store={store} />;
    case "debug":     return <DebugPanel store={store} />;
  }
}

// ── Log sidebar for desktop right column ──

function LogSidebar({ store }: { store: GameStore }) {
  const { store: s } = useStore(store);
  return (
    <ActivityLogPanel
      entries={s.state.gameLog}
      emptyMessage={T.tab_log}
      limit={50}
    />
  );
}

// ── Catch-up overlay ──

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
        const timer = setTimeout(() => setResult(null), 4000);
        return () => clearTimeout(timer);
      }
    });
    return () => { offProgress(); offApplied(); };
  }, [store.bus]);

  if (!progress && !result) return null;
  const pct = progress ? progress.done / progress.total : 1;

  return (
    <div className="mx-3 mt-2 p-2 bg-blue-950/40 rounded-md border border-blue-800/40">
      {progress && (
        <>
          <div className="flex justify-between text-[12px] mb-1">
            <span className="text-blue-300">{T.catchUpInProgress}</span>
            <span className="tabular-nums opacity-70">
              {fmt(T.catchUpProgressLabel, { done: progress.done, total: progress.total })}
              {" \u00b7 "}{Math.round(pct * 100)}%
            </span>
          </div>
          <div className="h-1.5 bg-black/40 rounded-full overflow-hidden">
            <div
              className="h-full bg-blue-500 rounded-full transition-[width] duration-75 ease-linear"
              style={{ width: `${pct * 100}%` }}
            />
          </div>
          <div className="mt-1 flex justify-end">
            <button
              type="button"
              onClick={() => store.cancelCatchUp()}
              className="px-2 py-0.5 text-[11px] rounded border border-red-900/60 text-red-400 cursor-pointer hover:bg-red-950/30"
            >
              {T.catchUpCancel}
            </button>
          </div>
        </>
      )}
      {!progress && result && (
        <div className="text-[12px] text-green-400">{result}</div>
      )}
    </div>
  );
}

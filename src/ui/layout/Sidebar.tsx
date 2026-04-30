// Sidebar — desktop left navigation (icon + label vertical strip).

import type { TabId } from "./AppShell";

export interface SidebarProps {
  activeTab: TabId;
  onSelect: (id: TabId) => void;
  isUnlocked: (id: TabId) => boolean;
  showDebug: boolean;
}

interface NavItem {
  id: TabId;
  label: string;
  icon: string; // SVG path (d attribute, stroke-only)
}

const TOP_NAV: NavItem[] = [
  { id: "battle",    label: "\u6218\u6597", icon: "M13 10V3L4 14h7v7l9-11h-7z" },
  { id: "map",       label: "\u5730\u56fe", icon: "M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l5.447 2.724A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" },
  { id: "inventory", label: "\u80cc\u5305", icon: "M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" },
  { id: "craft",     label: "\u5408\u6210", icon: "M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94l-3.76 3.76z" },
  { id: "talents",   label: "\u5929\u8d4b", icon: "M12 2l3.09 6.26L22 9.27l-5 4.87L18.18 21 12 17.77 5.82 21 7 14.14l-5-4.87 6.91-1.01L12 2z" },
  { id: "stats",     label: "\u5c5e\u6027", icon: "M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4-4v-2m0 0a4 4 0 014-4h0a4 4 0 014 4m-4-4v8m6-4h6m-3-3v6" },
  { id: "upgrades",  label: "\u5347\u7ea7", icon: "M23 6l-9.5 9.5-5-5L1 18M17 6h6V12" },
  { id: "quests",    label: "\u4efb\u52a1", icon: "M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" },
];

const SETTINGS_NAV: NavItem = {
  id: "settings", label: "\u8bbe\u7f6e",
  icon: "M12.22 2h-.44a2 2 0 00-2 2v.18a2 2 0 01-1 1.73l-.43.25a2 2 0 01-2 0l-.15-.08a2 2 0 00-2.73.73l-.22.38a2 2 0 00.73 2.73l.15.1a2 2 0 011 1.72v.51a2 2 0 01-1 1.74l-.15.09a2 2 0 00-.73 2.73l.22.38a2 2 0 002.73.73l.15-.08a2 2 0 012 0l.43.25a2 2 0 011 1.73V20a2 2 0 002 2h.44a2 2 0 002-2v-.18a2 2 0 011-1.73l.43-.25a2 2 0 012 0l.15.08a2 2 0 002.73-.73l.22-.39a2 2 0 00-.73-2.73l-.15-.08a2 2 0 01-1-1.74v-.5a2 2 0 011-1.74l.15-.09a2 2 0 00.73-2.73l-.22-.38a2 2 0 00-2.73-.73l-.15.08a2 2 0 01-2 0l-.43-.25a2 2 0 01-1-1.73V4a2 2 0 00-2-2z M12 8a4 4 0 100 8 4 4 0 000-8z",
};

const DEBUG_NAV: NavItem = {
  id: "debug", label: "\u8C03\u8BD5",
  icon: "M12 2a10 10 0 00-10 10 10 10 0 0010 10 10 10 0 0010-10A10 10 0 0012 2zm0 4v6l4 2",
};

export function Sidebar({ activeTab, onSelect, isUnlocked, showDebug }: SidebarProps) {
  return (
    <aside className="w-16 bg-surface flex flex-col items-center py-4 gap-1 border-r border-border shrink-0">
      {/* Logo */}
      <div className="text-accent font-bold text-lg mb-4 select-none">Y</div>

      {/* Top nav */}
      {TOP_NAV.map((n) => (
        <SidebarBtn
          key={n.id}
          item={n}
          active={activeTab === n.id}
          disabled={!isUnlocked(n.id)}
          onClick={() => onSelect(n.id)}
        />
      ))}

      <div className="flex-1" />

      {/* Debug (dev only) */}
      {showDebug && (
        <SidebarBtn item={DEBUG_NAV} active={activeTab === "debug"} disabled={false} onClick={() => onSelect("debug")} />
      )}

      {/* Settings at bottom */}
      <SidebarBtn item={SETTINGS_NAV} active={activeTab === "settings"} disabled={false} onClick={() => onSelect("settings")} />
    </aside>
  );
}

function SidebarBtn({
  item,
  active,
  disabled,
  onClick,
}: {
  item: NavItem;
  active: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      title={item.label}
      className={`w-12 h-12 rounded-lg flex flex-col items-center justify-center cursor-pointer transition-colors duration-100
        ${disabled
          ? "text-gray-700 cursor-not-allowed"
          : active
            ? "bg-surface-light text-accent"
            : "text-gray-500 hover:bg-surface-light hover:text-gray-400"}`}
    >
      <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
        <path d={item.icon} strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <span className="text-[10px] mt-0.5">{item.label}</span>
    </button>
  );
}

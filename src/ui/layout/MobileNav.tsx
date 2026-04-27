// MobileNav — bottom navigation bar for mobile layout.
//
// Shows as many tabs as can fit, with a "more" overflow menu for the rest.
// Uses a ResizeObserver to measure available width dynamically.

import { useState, useRef, useEffect, useCallback } from "react";
import type { TabId } from "./AppShell";

export interface MobileNavProps {
  activeTab: TabId;
  onSelect: (id: TabId) => void;
  showDebug?: boolean;
}

interface NavItemDef {
  id: TabId;
  label: string;
  icon: string;
}

// All items in priority order
const ALL_ITEMS: NavItemDef[] = [
  { id: "battle",    label: "\u6218\u6597", icon: "M13 10V3L4 14h7v7l9-11h-7z" },
  { id: "map",       label: "\u5730\u56fe", icon: "M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l5.447 2.724A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" },
  { id: "inventory", label: "\u80cc\u5305", icon: "M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" },
  { id: "craft",     label: "\u5408\u6210", icon: "M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94l-3.76 3.76z" },
  { id: "talents",   label: "\u5929\u8d4b", icon: "M12 2l3.09 6.26L22 9.27l-5 4.87L18.18 21 12 17.77 5.82 21 7 14.14l-5-4.87 6.91-1.01L12 2z" },
  { id: "stats",     label: "\u5c5e\u6027", icon: "M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4-4v-2m0 0a4 4 0 014-4h0a4 4 0 014 4m-4-4v8m6-4h6m-3-3v6" },
  { id: "upgrades",  label: "\u5347\u7ea7", icon: "M23 6l-9.5 9.5-5-5L1 18M17 6h6V12" },
  { id: "settings",  label: "\u8bbe\u7f6e", icon: "M12.22 2h-.44a2 2 0 00-2 2v.18a2 2 0 01-1 1.73l-.43.25a2 2 0 01-2 0l-.15-.08a2 2 0 00-2.73.73l-.22.38a2 2 0 00.73 2.73l.15.1a2 2 0 011 1.72v.51a2 2 0 01-1 1.74l-.15.09a2 2 0 00-.73 2.73l.22.38a2 2 0 002.73.73l.15-.08a2 2 0 012 0l.43.25a2 2 0 011 1.73V20a2 2 0 002 2h.44a2 2 0 002-2v-.18a2 2 0 011-1.73l.43-.25a2 2 0 012 0l.15.08a2 2 0 002.73-.73l.22-.39a2 2 0 00-.73-2.73l-.15-.08a2 2 0 01-1-1.74v-.5a2 2 0 011-1.74l.15-.09a2 2 0 00.73-2.73l-.22-.38a2 2 0 00-2.73-.73l-.15.08a2 2 0 01-2 0l-.43-.25a2 2 0 01-1-1.73V4a2 2 0 00-2-2z M12 8a4 4 0 100 8 4 4 0 000-8z" },
];

const MORE_ICON = "M4 6h16M4 12h16M4 18h16";

// Approximate width per button (icon + label + padding)
const BTN_WIDTH = 56;
// "More" button itself takes one slot
const MORE_BTN_WIDTH = 56;

export function MobileNav({ activeTab, onSelect, showDebug }: MobileNavProps) {
  const navRef = useRef<HTMLElement>(null);
  const [visibleCount, setVisibleCount] = useState(ALL_ITEMS.length);
  const [moreOpen, setMoreOpen] = useState(false);
  const moreRef = useRef<HTMLDivElement>(null);

  const items = showDebug
    ? [...ALL_ITEMS, { id: "debug" as TabId, label: "\u8c03\u8bd5", icon: "M12 2a10 10 0 00-10 10 10 10 0 0010 10 10 10 0 0010-10A10 10 0 0012 2zm0 4v6l4 2" }]
    : ALL_ITEMS;

  // Measure how many buttons fit
  const measure = useCallback(() => {
    if (!navRef.current) return;
    const totalWidth = navRef.current.clientWidth;
    const maxFit = Math.floor(totalWidth / BTN_WIDTH);

    if (maxFit >= items.length) {
      // All fit, no "more" needed
      setVisibleCount(items.length);
    } else {
      // Reserve one slot for "more"
      const slotsForItems = Math.max(1, Math.floor((totalWidth - MORE_BTN_WIDTH) / BTN_WIDTH));
      setVisibleCount(Math.min(slotsForItems, items.length));
    }
  }, [items.length]);

  useEffect(() => {
    measure();
    const ro = new ResizeObserver(measure);
    if (navRef.current) ro.observe(navRef.current);
    return () => ro.disconnect();
  }, [measure]);

  // Close popup on outside click
  useEffect(() => {
    if (!moreOpen) return;
    function handleClick(e: MouseEvent) {
      if (moreRef.current && !moreRef.current.contains(e.target as Node)) {
        setMoreOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [moreOpen]);

  const visible = items.slice(0, visibleCount);
  const overflow = items.slice(visibleCount);
  const needsMore = overflow.length > 0;
  const overflowIds = new Set(overflow.map((o) => o.id));
  const moreActive = overflowIds.has(activeTab);

  return (
    <nav ref={navRef} className="h-14 bg-surface border-t border-border flex items-center justify-around shrink-0 z-50 relative">
      {visible.map((item) => (
        <NavButton
          key={item.id}
          icon={item.icon}
          label={item.label}
          active={activeTab === item.id}
          onClick={() => { setMoreOpen(false); onSelect(item.id); }}
        />
      ))}

      {needsMore && (
        <div ref={moreRef} className="relative">
          <NavButton
            icon={MORE_ICON}
            label={"\u66f4\u591a"}
            active={moreActive}
            onClick={() => setMoreOpen((v) => !v)}
          />

          {moreOpen && (
            <div className="absolute bottom-full right-0 mb-2 bg-surface-light border border-border rounded-lg shadow-xl py-1 min-w-[120px]">
              {overflow.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    setMoreOpen(false);
                    onSelect(item.id);
                  }}
                  className={`w-full text-left px-4 py-2.5 text-sm cursor-pointer transition-colors
                    ${activeTab === item.id
                      ? "text-accent bg-accent/10"
                      : "text-gray-300 hover:bg-surface-lighter"}`}
                >
                  {item.label}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </nav>
  );
}

function NavButton({
  icon,
  label,
  active,
  onClick,
}: {
  icon: string;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`relative flex flex-col items-center gap-0.5 px-2 py-1 cursor-pointer transition-colors shrink-0
        ${active ? "text-accent" : "text-gray-500"}`}
    >
      {active && (
        <span className="absolute top-0 left-1/4 right-1/4 h-0.5 bg-accent rounded-sm" />
      )}
      <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
        <path d={icon} strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <span className="text-[10px]">{label}</span>
    </button>
  );
}

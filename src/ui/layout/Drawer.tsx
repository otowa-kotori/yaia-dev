// Drawer — mobile bottom sheet that slides up from the navigation bar.
//
// When open, it covers the main content area with a semi-transparent overlay
// and shows the panel content in a card that sits above the MobileNav.

import type { ReactNode } from "react";

export interface DrawerProps {
  isOpen: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
}

export function Drawer({ isOpen, title, onClose, children }: DrawerProps) {
  return (
    <>
      {/* Overlay */}
      {isOpen && (
        <div
          className="fixed inset-0 bg-black/40 z-40 lg:hidden"
          onClick={onClose}
        />
      )}

      {/* Sheet */}
      <div
        className={`fixed inset-x-0 bottom-14 bg-surface-light border-t border-border rounded-t-2xl z-40 lg:hidden
          transition-transform duration-300 ease-out
          ${isOpen ? "translate-y-0" : "translate-y-full"}`}
        style={{ height: "60vh" }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-border">
          <span className="text-white text-sm font-medium">{title}</span>
          <button
            type="button"
            onClick={onClose}
            className="text-gray-500 hover:text-gray-300 text-lg leading-none cursor-pointer"
          >
            &times;
          </button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto" style={{ height: "calc(100% - 42px)" }}>
          {children}
        </div>
      </div>
    </>
  );
}

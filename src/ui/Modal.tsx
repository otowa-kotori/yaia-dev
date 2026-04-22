// Shared modal shell for focused flows such as dungeon party selection.
//
// Intentionally small and controlled: the caller owns open/close state and
// provides the body/footer content. This keeps business logic outside the
// generic dialog container.

import type { ReactNode } from "react";
import { T } from "./text";

export interface ModalProps {
  isOpen: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}

export function Modal({
  isOpen,
  title,
  onClose,
  children,
  footer,
}: ModalProps) {
  if (!isOpen) return null;

  return (
    <div style={overlayStyle} onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        style={panelStyle}
        onClick={(event) => event.stopPropagation()}
      >
        <div style={headerStyle}>
          <div style={titleStyle}>{title}</div>
          <button
            type="button"
            title={T.dialogClose}
            aria-label={T.dialogClose}
            onClick={onClose}
            style={closeButtonStyle}
          >
            ×
          </button>
        </div>
        <div style={bodyStyle}>{children}</div>
        {footer ? <div style={footerStyle}>{footer}</div> : null}
      </div>
    </div>
  );
}

const overlayStyle: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(0, 0, 0, 0.6)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 16,
  zIndex: 1000,
};

const panelStyle: React.CSSProperties = {
  width: "min(520px, 100%)",
  background: "#1a1a1a",
  border: "1px solid #3a3a3a",
  borderRadius: 8,
  boxShadow: "0 12px 32px rgba(0, 0, 0, 0.35)",
};

const headerStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 12,
  padding: "12px 14px",
  borderBottom: "1px solid #333",
};

const titleStyle: React.CSSProperties = {
  fontSize: 16,
  fontWeight: 700,
  color: "#fff",
};

const closeButtonStyle: React.CSSProperties = {
  width: 28,
  height: 28,
  borderRadius: 6,
  border: "1px solid #444",
  background: "#222",
  color: "#bbb",
  cursor: "pointer",
  fontFamily: "inherit",
  fontSize: 16,
  lineHeight: 1,
};

const bodyStyle: React.CSSProperties = {
  padding: 14,
};

const footerStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "flex-end",
  gap: 8,
  padding: "0 14px 14px",
};

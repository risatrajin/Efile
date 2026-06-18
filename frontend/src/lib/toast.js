import React, { useEffect, useState } from "react";
import { CheckCircle2, AlertCircle, X } from "lucide-react";

// ---------------------------------------------------------------------------
// Minimal global toast. There was no app-wide confirmation pattern before, so
// this is intentionally tiny: a module-level store + pub/sub and a single
// <ToastHost/> mounted once at the app root (outside <Routes>) so toasts
// survive route changes — e.g. "Assign & Move to Intake" navigates straight
// to the dashboard and the confirmation must still appear there.
// ---------------------------------------------------------------------------

let _id = 0;
let _toasts = [];
const listeners = new Set();

function emit() {
  listeners.forEach((l) => l(_toasts));
}

export function dismissToast(id) {
  _toasts = _toasts.filter((t) => t.id !== id);
  emit();
}

export function toast(message, type = "success", opts = {}) {
  const id = ++_id;
  const duration = opts.duration ?? 4000;
  _toasts = [..._toasts, { id, message, type }];
  emit();
  if (duration > 0) setTimeout(() => dismissToast(id), duration);
  return id;
}

const STYLES = {
  success: { bg: "#e8f5e9", fg: "#1b5e20", border: "#a5d6a7", Icon: CheckCircle2 },
  error: { bg: "#fdecea", fg: "#b71c1c", border: "#ef9a9a", Icon: AlertCircle },
};

export function ToastHost() {
  const [items, setItems] = useState(_toasts);
  useEffect(() => {
    const l = (next) => setItems([...next]);
    listeners.add(l);
    setItems([..._toasts]);
    return () => { listeners.delete(l); };
  }, []);

  if (!items.length) return null;
  return (
    <div
      data-testid="toast-host"
      role="region"
      aria-label="Notifications"
      style={{ position: "fixed", bottom: 20, right: 20, zIndex: 9999, display: "flex", flexDirection: "column", gap: 10, maxWidth: 400 }}
    >
      {items.map((t) => {
        const s = STYLES[t.type] || STYLES.success;
        const Icon = s.Icon;
        return (
          <div
            key={t.id}
            data-testid="toast"
            role="status"
            aria-live="polite"
            style={{
              display: "flex", alignItems: "flex-start", gap: 10,
              padding: "12px 14px", borderRadius: 10,
              background: s.bg, color: s.fg, border: `1px solid ${s.border}`,
              boxShadow: "0 8px 24px rgba(0,0,0,0.12)", fontSize: 13, fontWeight: 500,
              animation: "toast-in 160ms ease",
            }}
          >
            <Icon size={16} style={{ flexShrink: 0, marginTop: 1 }} />
            <span style={{ flex: 1, lineHeight: 1.45 }}>{t.message}</span>
            <button
              onClick={() => dismissToast(t.id)}
              aria-label="Dismiss notification"
              style={{ background: "none", border: "none", cursor: "pointer", color: "inherit", opacity: 0.7, flexShrink: 0, padding: 0, lineHeight: 0 }}
            >
              <X size={14} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
